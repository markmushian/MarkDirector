<template>
  <div class="projectPage">
    <header class="projectHeader">
      <button class="backButton" type="button" aria-label="返回首页" title="返回首页" @click="router.push('/home')">
        <icon-arrow-left :size="18" aria-hidden="true" />
      </button>
      <div class="projectTitle">
        <h1>{{ meta?.name || project?.name || "项目" }}</h1>
        <span v-if="meta" class="styleTag">{{ styleName }}</span>
      </div>
      <span class="projectCounters">{{ counters }}</span>
      <el-button class="headerAction" :icon="IconSettings" @click="openProjectInfo">项目信息</el-button>
      <el-button v-if="scriptTarget" class="headerAction" :icon="IconMovie" @click="enterCurrentEpisode">本集画布</el-button>
      <el-button class="headerAction" :icon="IconMovie" :disabled="!episodes.length" @click="enterWhole">整片画布</el-button>
      <el-button class="headerAction" type="primary" :icon="IconPlus" @click="openAddEpisode">添加集</el-button>
    </header>

    <nav class="projectTabs" aria-label="项目视图">
      <button type="button" :class="{ active: tab === 'episodes' }" @click="tab = 'episodes'">剧集列表<span>{{ episodes.length }}</span></button>
      <button type="button" :class="{ active: tab === 'assets' }" @click="tab = 'assets'">素材库<span>{{ assetTotal }}</span></button>
      <button type="button" :class="{ active: tab === 'script' }" @click="tab = 'script'">剧本</button>
    </nav>

    <main class="projectBody">
      <p v-if="error" class="pageHint error" role="alert">{{ error }}</p>

      <section v-if="tab === 'episodes'" class="episodePane">
        <div class="episodeGrid">
          <article v-for="episode in episodes" :key="episode.id" class="episodeCard">
            <div class="episodeTop">
              <span class="episodeIndex">{{ episode.id }}</span>
              <span class="episodeStatus" :data-status="episode.status ?? 'draft'">{{ statusText(episode) }}</span>
            </div>
            <h2 class="episodeTitle" :title="episode.title">{{ episode.title }}</h2>
            <p class="episodeMeta">{{ episodeMetaText(episode) }}</p>
            <div class="episodeStages" :aria-label="`制作进度：${episodeStageText(episode)}`">
              <span v-for="stage in EPISODE_STAGES" :key="stage.key" class="stageChip" :class="{ done: episodeStages[episode.id]?.[stage.key] }">
                <i class="stageDot" aria-hidden="true" />{{ stage.label }}
              </span>
            </div>
            <div class="episodeActions">
              <el-button size="small" type="primary" plain :icon="IconPlayerPlay" @click="enterEpisode(episode)">进入制作</el-button>
              <el-dropdown trigger="click" placement="bottom-end" :showArrow="false">
                <el-button size="small" text :icon="IconDots" aria-label="更多操作" />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item :icon="IconPencil" @click="renameEpisode(episode)">重命名</el-dropdown-item>
                    <el-dropdown-item :icon="IconFileText" @click="openScript(episode)">编辑剧本</el-dropdown-item>
                    <el-dropdown-item class="removeAction" :icon="IconTrash" divided @click="removeEpisode(episode)">移除集</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </article>
          <button class="episodeAdd" type="button" :disabled="busy" @click="openAddEpisode">
            <icon-plus :size="20" aria-hidden="true" />
            <span>添加第 {{ episodes.length + 1 }} 集</span>
          </button>
        </div>
        <p v-if="!episodes.length" class="pageHint">还没有分集。每集是一个独立子目录，自带剧本和画布，互不影响。</p>
      </section>

      <section v-else-if="tab === 'assets'" class="assetPane">
        <projectAssetLibrary :directory="directory" />
      </section>

      <section v-else class="scriptPane">
        <aside class="scriptAside">
          <button type="button" :class="{ active: scriptTarget === '' }" @click="selectScript('')">整片剧本</button>
          <button v-for="episode in episodes" :key="episode.id" type="button" :class="{ active: scriptTarget === episode.id }" @click="selectScript(episode.id)">
            <span class="asideIndex">{{ episode.id }}</span>{{ episode.title }}
            <span v-if="isTaskRunning(episode.id)" class="asideRunning" title="正在改写" aria-label="正在改写" />
          </button>
        </aside>
        <div class="scriptEditor">
          <ol v-if="!scriptTarget" class="scriptFlow" aria-label="剧本流程">
            <li class="flowGroupLabel" title="①–⑤ 在剧本页执行（亮色是当前该做的一步）；虚线的 ⑥–⑧ 是后续环节提醒，点开看在哪做、检查什么">制作流程</li>
            <li v-for="(step, index) in flowSteps" :key="step.key" :class="{ done: step.done, current: step.current, soft: step.soft }">
              <button type="button" :disabled="step.disabled" :title="step.tip" @click="runFlowStep(step.key)">
                <span class="flowIndex">{{ index + 1 }}</span>
                <span class="flowText"><strong>{{ step.label }}</strong><small>{{ step.hint }}</small></span>
              </button>
              <icon-chevron-right v-if="index < flowSteps.length - 1" class="flowArrow" :size="13" aria-hidden="true" />
            </li>
          </ol>
          <div class="deliverableBar">
            <template v-if="!scriptTarget">
              <span class="deliverableLabel" title="只在「整片剧本」生效，产出全剧共用文件；分集制作前必须先生成资产提示词库">全剧文档</span>
              <el-select v-model="docTopic" class="docTopicSelect" size="small" filterable clearable placeholder="题材模板（可选）" aria-label="题材模板" @focus="loadProduceSkills">
                <el-option v-for="item in topicSkills" :key="item.name" :label="skillLabel(item)" :value="item.name">
                  <span class="skillOptionName">{{ skillCnName(item) }}</span>
                  <span class="skillOptionId">{{ item.name }}</span>
                </el-option>
              </el-select>
              <el-button size="small" :icon="IconFileText" :loading="docRunning === 'plan'" :disabled="!!docRunning" title="读 script.md / rewrite.md → 写 企划案.md（全剧 13 项：卖点、逐集钩子、人物表、伏笔、声音、发布计划）" @click="runDeliverable('plan')">生成企划案</el-button>
              <el-button size="small" type="primary" plain :icon="IconSparkles" :loading="docRunning === 'assets'" :disabled="!!docRunning" title="读 script.md 提取人物/场景/道具 → 写 assets/资产库.md，每张卡一整块可直接复制去抽卡的提示词" @click="runDeliverable('assets')">生成资产提示词库</el-button>
            </template>
            <el-button size="small" :icon="IconAdjustments" :title="scriptTarget ? '只读查看本集 分镜表 / 节拍表 / shots.md / publish.md，以及全剧 novel.md、beat.md、企划案.md、assets/资产库.md，可一键复制全文' : '只读查看 novel.md、beat.md、企划案.md、assets/资产库.md，可一键复制全文'" @click="openDeliverables()">查看 / 复制</el-button>
            <span v-if="!scriptTarget" class="deliverableHint">人物 · 道具 · 场景 · 特效，整块提示词可直接抽卡；分集制作前先生成</span>
            <span v-else class="deliverableHint">先「生成分镜表 / 节拍表」验收镜头与时长，再制作；产出后可在这里查看复制</span>
          </div>
          <div class="scriptToolbar">
            <div class="scriptToolbarMeta">
              <span class="toolbarGroup" :title="scriptTarget ? '按钮只作用于当前选中的这一集，文件都在 episodes/NN-标题/ 里' : '这一行是设置与保存；剧本主操作在上方流程条 1→8 步'">{{ scriptTarget ? "当前分集" : "当前剧本" }}</span>
              <strong class="toolbarTitle" :title="scriptLabel">{{ scriptLabel }}</strong>
              <span class="toolbarHint">{{ scriptTarget ? "改动只影响这一集" : "主操作点上方流程条" }}</span>
              <span v-if="anyDirty" class="dirtyHint">未保存</span>
              <span v-if="rewriting" class="dirtyHint">正在改写…</span>
            </div>
            <div class="scriptToolbarActions">
              <el-popover v-model:visible="promptOpen" placement="bottom-end" :width="540" trigger="click" popper-class="rewritePromptPopper" :teleported="true">
                <template #reference>
                  <el-button size="small" :icon="IconAdjustments" :class="{ promptCustom: promptCustomized }" title="分别设置「节奏改写」与「原地改写」的要求；内容存在本地，留空用内置、填写后整段替换" aria-label="剧本改写提示词">提示词</el-button>
                </template>
                <div class="promptPanel">
                  <div class="promptModeSwitch">
                    <el-button size="small" :type="promptMode === 'beat' ? 'primary' : ''" @click="promptMode = 'beat'">② 节奏改写</el-button>
                    <el-button size="small" :type="promptMode === 'rewrite' ? 'primary' : ''" @click="promptMode = 'rewrite'">③ / 分集 原地改写</el-button>
                  </div>
                  <div class="promptPanelHead">
                    <strong>{{ promptMode === "beat" ? "节奏改写提示词" : "剧本改写提示词" }}</strong>
                    <span>{{ promptMode === "beat" ? "内容层：允许删场次、调顺序、加钩子与反转；只对整片生效" : "制作层：只改镜头表达，严禁改剧情结构" }}</span>
                    <el-button link size="small" :disabled="rewriting || !promptCustomized" @click="resetRewritePrompt">恢复默认</el-button>
                  </div>
                  <el-input v-model="activePrompt" type="textarea" :autosize="{ minRows: 8, maxRows: 16 }" resize="none" :disabled="rewriting" :placeholder="promptMode === 'beat' ? '留空用内置默认要求。例如：前 3 秒进冲突，删掉所有铺垫过场，每集一个反转，结尾一句台词留钩子…' : '留空用内置默认要求（整片=改成分镜脚本，分集=精修不改结构）。例如：每场不超过 3 个镜头，台词口语化…'" aria-label="改写提示词" />
                  <p class="promptPanelFoot">当前使用：{{ promptCustomized ? "自定义要求" : "默认要求" }} · 两种模式分开保存，切换不互相覆盖</p>
                  <div v-if="scriptTarget" class="promptPanelSkill">
                    <div class="promptPanelHead">
                      <strong>制作技能</strong>
                      <span>「交给工作区制作」时自动调用</span>
                    </div>
                    <el-select v-model="produceSkill" size="small" clearable filterable :loading="produceSkillLoading" placeholder="不指定，由 Agent 自行判断" aria-label="制作技能" @focus="loadProduceSkills">
                      <el-option v-for="item in produceSkills" :key="item.name" :label="skillLabel(item)" :value="item.name">
                        <span class="skillOptionName">{{ skillCnName(item) }}</span>
                        <span class="skillOptionId">{{ item.name }}</span>
                      </el-option>
                    </el-select>
                    <p class="promptPanelFoot">选中后会在制作指令最前面加 /skill:名称，强制 Agent 先读技能再动手；留空则由 Agent 自己判断。</p>
                  </div>
                </div>
              </el-popover>
              <el-select v-model="rewriteModel" class="rewriteModel" size="small" filterable placeholder="选择文本模型" :loading="modelsLoading" title="选跑 Agent 的文本模型" aria-label="改写模型">
                <el-option v-for="item in textModels" :key="modelKey(item)" :label="`${item.label} · ${item.providerLabel}`" :value="modelKey(item)" />
              </el-select>
              <el-button v-if="scriptTarget" size="small" type="primary" plain :icon="IconWand" :loading="rewriting" :disabled="!scriptText.trim() || rewriting" title="读这一集 script.md → 写这一集 rewrite.md（精修分镜脚本，不改剧情结构）；整片请点上方流程条" @click="runRewrite">原地改写</el-button>
              <el-button v-if="scriptTarget" size="small" :icon="IconMovie" title="进这一集的画布，不改动任何文件" @click="enterCurrentEpisode">本集画布</el-button>
              <el-button v-if="scriptTarget" size="small" type="primary" plain :icon="IconListNumbers" :loading="storyboardRunning" :disabled="(!scriptText.trim() && !rewriteText.trim()) || rewriting || storyboardRunning" title="读本集 rewrite.md（没有则 script.md）→ 写 分镜表.md（逐镜 L01、15 字段）与 节拍表.md（逐秒）；制作前先生成并验收" @click="runStoryboard">生成分镜表 / 节拍表</el-button>
              <el-button v-if="scriptTarget" size="small" type="primary" :icon="IconMicrophone" :disabled="(!scriptText.trim() && !rewriteText.trim()) || rewriting" :title="produceSkill ? `按 /skill:${produceSkill} 制作这一集` : '按本集分镜表在画布出图出视频，并写 shots.md / publish.md；制作前先生成资产提示词库与分镜表'" @click="askRewrite">交给工作区制作</el-button>
              <el-button size="small" type="primary" :loading="saving" :disabled="!anyDirty" title="把三栏手改的内容写回 script.md / beat.md / rewrite.md" @click="saveScript(false)">保存</el-button>
            </div>
          </div>
          <div v-if="rewriting" class="rewriteProgress" role="status" aria-live="polite">
            <span class="pulse" aria-hidden="true" />
            <span class="progressText">{{ rewriteStageText }}</span>
            <span v-if="rewriteStepCount > 0" class="progressCount">{{ rewriteStepCount }} 步</span>
          </div>
          <div v-if="!scriptText.trim() && !creating" class="scriptEmpty">
            <div>
              <strong>{{ scriptTarget ? "这一集还没有剧本" : "还没有剧本内容" }}</strong>
              <p>{{ scriptTarget ? "分集剧本由「按集拆分」从整片节奏稿 / 分镜稿生成；要重写整片，请点左侧「整片剧本」。" : "原创用「AI 创作 / 改编剧本」从一句话点子写；改编番茄小说 / 原创小说请切到「改编」模式，原文存 novel.md、改编结果写 script.md。之后按流程条 ② 节奏改写 → ③ 分镜改写 → ④ 按集拆分 → 逐集生成分镜表 / 节拍表 → ⑤ 分集制作。" }}</p>
            </div>
            <el-button v-if="!scriptTarget" size="small" type="primary" :icon="IconSparkles" @click="openCreate">AI 创作剧本</el-button>
          </div>
          <div v-if="creating" class="rewriteProgress" role="status" aria-live="polite">
            <span class="pulse" aria-hidden="true" />
            <span class="progressText">{{ createStage || "正在创作剧本…" }}</span>
            <span v-if="rewriteTasks['__create__']?.steps" class="progressCount">{{ rewriteTasks["__create__"].steps }} 步</span>
          </div>
          <div class="scriptColumns">
            <label class="scriptColumn">
              <span class="columnLabel">原文 script.md</span>
              <textarea v-model="scriptText" spellcheck="false" :placeholder="scriptTarget ? '本集结构化剧本（由按集拆分生成）；不要直接贴小说原文' : '结构化剧本 script.md：由 ① 创作 / 改编生成。小说原文存 novel.md，不要直接把小说叙述体贴进来，否则 ②③ 会当成剧本处理'" @input="onColumnInput('script')" />
            </label>
            <label v-if="!scriptTarget" class="scriptColumn beatColumn">
              <span class="columnLabel">节奏稿 beat.md · ② 节奏改写</span>
              <textarea v-model="beatText" spellcheck="false" placeholder="节奏改写结果写在这里：删拖沓、开场钩子、冲突反转、结尾悬念；可以直接手改…" @input="onColumnInput('beat')" />
            </label>
            <label class="scriptColumn">
              <span class="columnLabel">改写 rewrite.md{{ scriptTarget ? " · 分集精修" : " · ③ 分镜改写" }}</span>
              <textarea v-model="rewriteText" spellcheck="false" placeholder="助手改写后的分镜剧本会写在这里，也可以手改…" @input="onColumnInput('rewrite')" />
            </label>
          </div>
        </div>
      </section>
    </main>

    <el-dialog v-model="addOpen" title="添加集" width="min(420px, 92vw)" alignCenter appendToBody destroyOnClose>
      <el-form labelPosition="top" @submit.prevent="confirmAddEpisode">
        <el-form-item label="本集标题" required>
          <el-input ref="addInput" v-model="draftTitle" maxlength="40" placeholder="例如：她真的是我女儿" @keydown.enter.prevent="confirmAddEpisode" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addOpen = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="!draftTitle.trim()" @click="confirmAddEpisode">创建</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="splitOpen" title="按集拆分" width="min(620px, 94vw)" alignCenter appendToBody :closeOnClickModal="!splitBusy">
      <p class="splitHint">从 {{ splitSourceLabel }} 里识别到 {{ splitItems.length }} 集。确认后每集会建独立目录（本集剧本 + 空画布），已有同号集会跳过。</p>
      <div class="splitList">
        <div v-for="item in splitItems" :key="item.id" class="splitRow" :class="{ exists: item.exists }">
          <el-checkbox v-model="item.checked" :disabled="item.exists || splitBusy" />
          <span class="splitId">{{ item.id }}</span>
          <el-input v-model="item.title" size="small" maxlength="30" :disabled="item.exists || splitBusy" :aria-label="`第${item.id}集标题`" />
          <span class="splitMeta">{{ item.exists ? "已存在" : `${item.content.length} 字` }}</span>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="splitBusy" @click="splitOpen = false">取消</el-button>
        <el-button type="primary" :loading="splitBusy" :disabled="!splitCheckedCount" @click="confirmSplit">创建 {{ splitCheckedCount }} 集</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="createOpen" title="AI 创作 / 改编剧本" width="min(680px, 94vw)" alignCenter appendToBody :closeOnClickModal="!creating" :closeOnPressEscape="!creating">
      <el-form labelPosition="top" @submit.prevent="runCreate">
        <el-form-item label="输入类型">
          <el-radio-group v-model="createMode" size="small" :disabled="creating">
            <el-radio-button value="original">原创 · 一句话点子</el-radio-button>
            <el-radio-button value="adapt">改编 · 粘贴小说原文</el-radio-button>
          </el-radio-group>
          <p class="adaptHint">{{ createMode === "adapt" ? "小说是文学语言、剧本是视听语言，不能直接拿小说出分镜。原文追加存 novel.md 并自动切片，AI 按批次读本批分片改编成 script.md，用「创作状态.md」保持人物与伏笔一致；之后照常走 ② 节奏改写 → ③ 分镜改写。" : "从零写一部结构化剧本；长剧按批推进，先建「创作状态.md」再逐批写集，现成小说请切到「改编」。" }}</p>
        </el-form-item>
        <el-form-item v-if="createMode === 'original'" label="一句话创意 / 题材">
          <el-input v-model="createIdea" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" resize="none" :disabled="creating" placeholder="例如：外卖员救下集团千金，被误认成豪门私生子，一路打脸逆袭…" />
        </el-form-item>
        <el-form-item v-else label="小说 / 网文原文（可整本粘贴，也可分章多次粘贴）">
          <el-input v-model="novelText" type="textarea" :autosize="{ minRows: 8, maxRows: 18 }" resize="none" :disabled="creating" placeholder="粘贴本次要改编的原文。会自动按段落切成每片≤12000字的小文件，Agent 每轮只读本批分片，不会把整本小说塞进上下文；novel.md 追加保存全文，永不覆盖。" />
          <p class="adaptHint">{{ novelCharCount }} 字{{ novelCharCount > 20000 ? " · 已自动切片，建议按「每批集数」分批推进" : "" }}；分章粘贴时后一次会追加到 novel.md 与 script.md，不会抹掉前面的成果。</p>
        </el-form-item>
        <div class="createRow">
          <el-form-item label="总集数">
            <el-input-number v-model="createEpisodes" :min="1" :max="200" :disabled="creating" size="small" controlsPosition="right" />
          </el-form-item>
          <el-form-item label="每批集数" title="一次只写这么多集，避免单轮输出过长被模型截断">
            <el-input-number v-model="createBatchSize" :min="1" :max="5" :disabled="creating" size="small" controlsPosition="right" />
          </el-form-item>
          <el-form-item label="单集时长（秒）">
            <el-input-number v-model="createDuration" :min="10" :max="900" :step="10" :disabled="creating" size="small" controlsPosition="right" />
          </el-form-item>
        </div>
        <p class="createBudget">
          <strong>{{ createProgressText }}</strong><br />
          长文本自动分批：每批只把「创作状态.md（人物 / 世界规则 / 伏笔 / 已写集摘要）」+ 本批原文分片放进上下文，每批用独立会话，历史不累积；写完一批先更新状态锚点再写剧本，避免后段上下文不够产生幻觉、剧情前后不一致。
        </p>
        <el-form-item :label="createMode === 'adapt' ? '改编要求（可留空）' : '创作要求（可留空）'">
          <el-input v-model="createRequirement" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" resize="none" :disabled="creating" :placeholder="createMode === 'adapt' ? '留空用默认改编要求。例如：保留原著名场面，砍掉全部心理独白，每集一个反转…' : '留空用默认要求。例如：竖屏女频复仇爽剧，每集一个反转，开头 3 秒抓人，结尾留钩子…'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="creating" @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="(!textModels.length && modelsLoading) || (createMode === 'adapt' && createDoneEpisodes === 0 && !novelText.trim())" @click="runCreate">{{ createFinished ? "重新开始" : createDoneEpisodes > 0 ? `继续下一批（${createProgressText}）` : createMode === "adapt" ? "开始改编" : "开始创作" }}</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="docViewOpen" title="制作文档 · 查看与复制" width="min(880px, 94vw)" alignCenter appendToBody>
      <div class="docViewHead">
        <el-select v-model="docViewKey" size="small" aria-label="选择制作文档">
          <el-option v-for="item in docViewItems" :key="item.key" :label="item.label" :value="item.key" />
        </el-select>
        <el-button size="small" type="primary" :disabled="!docViewText.trim()" @click="copyDocView">复制全文</el-button>
        <el-button v-if="docViewKey.startsWith('hist:')" size="small" type="warning" plain :disabled="!docViewText.trim()" @click="restoreDocView">恢复此版本</el-button>
        <span>{{ docViewKey.startsWith("hist:") ? "自动备份的旧版本，可查看或一键恢复" : "提示词可直接粘贴到出图 / 视频工具" }}</span>
      </div>
      <el-input v-model="docViewText" type="textarea" :autosize="{ minRows: 16, maxRows: 26 }" readonly resize="none" spellcheck="false" aria-label="制作文档内容" />
      <p v-if="!docViewText.trim()" class="docViewEmpty">这个文件还没生成。整片视角用「生成企划案 / 生成资产提示词库」；分集视角用「生成分镜表 / 节拍表」，或点「交给工作区制作」生成导演手册与发布包。下拉末尾是 history/ 里的自动备份，任何一次覆盖前的旧稿都能在这里查看或恢复。</p>
    </el-dialog>
    <projectInfoDialog v-model="infoVisible" :directory="directory" :meta="meta" @saved="onInfoSaved" />
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { ElMessage, ElMessageBox, type InputInstance } from "element-plus";
import { IconAdjustments, IconArrowLeft, IconChevronRight, IconListNumbers, IconMovie, IconDots, IconFileText, IconMicrophone, IconPencil, IconPlayerPlay, IconPlus, IconSettings, IconSparkles, IconTrash, IconWand } from "@tabler/icons-vue";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useWorkspaceStore } from "@/stores/workspace";
import { createProjectMeta, directoryDisplayName, normalizeProjectMeta, PROJECT_META_FILE, PROJECT_STATUS_TEXT, projectStyleName, type EpisodeMeta, type ProjectMeta } from "@/lib/projectMeta";
import projectAssetLibrary from "@/pages/home/projectAssetLibrary.vue";
import projectInfoDialog from "@/components/projectInfoDialog.vue";

const route = useRoute();
const router = useRouter();
const store = useWorkspaceStore();
const { project } = storeToRefs(store);
const directory = computed(() => project.value?.directory ?? "");
const meta = ref<ProjectMeta | null>(null);
// 全链路唯一画幅来源：正片/分镜图/节点配置都用它，避免同一份指令里 16:9 与 9:16 打架。
const filmAspect = computed(() => meta.value?.aspect || "9:16");
const filmResolution = computed(() => filmAspect.value === "9:16" ? "1080×1920" : filmAspect.value === "1:1" ? "1080×1080" : "1920×1080");
type ProjectTab = "episodes" | "assets" | "script";
const initialTab = typeof route.query.tab === "string" && ["episodes", "assets", "script"].includes(route.query.tab)
  ? route.query.tab as ProjectTab : "episodes";
const tab = ref<ProjectTab>(initialTab);
const error = ref("");
const busy = ref(false);
const addOpen = ref(false);
const draftTitle = ref("");
const addInput = ref<InputInstance>();
const scriptTarget = ref("");
const scriptText = ref("");
const rewriteText = ref("");
const scriptDirty = ref(false);
const rewriteDirty = ref(false);
const saving = ref(false);
const infoVisible = ref(false);
const splitOpen = ref(false);
const splitLoading = ref(false);
const splitBusy = ref(false);
const splitItems = ref<SplitItem[]>([]);
type SplitItem = { id: string; title: string; content: string; checked: boolean; exists: boolean };

const DEFAULT_REWRITE_PROMPT = [
  "把原文改写成可直接生成分镜的短剧场景脚本：",
  "1. 按场拆段，每场标注场号、场景、时间（日/夜）、景别与镜头运动；",
  "2. 每场写清角色动作、表情和台词，台词口语化、短句为主；",
  "3. 保留原文的人物关系、场次顺序和关键情节，只改镜头表达，不删场次、不新增剧情、不改写结构（改结构属于上一环节 beat.md）；",
  "4. 只输出剧本正文，不要解释、不要复述要求。",
].join("\n");
// 节奏改写 = 内容层，全流程里唯一允许改结构的环节：删拖沓、开场钩子、冲突反转、结尾悬念。
// 产出 beat.md；后面的分镜改写 / 拆集 / 制作一律以它为剧情基准且严禁再改结构。
const DEFAULT_BEAT_PROMPT = [
  "把剧本改写成节奏更快的竖屏短剧节奏稿，允许调整结构：",
  "1. 开场 3 秒进冲突，删掉铺垫、寒暄、环境交代和重复对白；过场戏能合并就合并、能删就删；",
  "2. 中段每集至少一次冲突升级或反转，把信息差、误会、打脸点提前，不平铺直叙；",
  "3. 每集结尾必须留钩子：一句反转台词、一个悬念画面或一个未解问题，且要接得上下集开头；",
  "4. 台词口语化、短句为主，用动作和反应代替解释性旁白，单场只保留推动剧情的信息；",
  "5. 保留人物关系、核心设定、主要情节走向和结局，不新增支线、不换主角、不改人设；允许删场次、合并场次、调整顺序与台词；",
  "6. 只输出剧本正文，不写修改说明、不复述要求；多集仍按「## 第01集 标题」分节，集号连续、标题不超过 12 字。",
].join("\n");
const DEFAULT_EPISODE_PROMPT = [
  "在现有分镜脚本基础上精修这一集：",
  "1. 保留场次顺序和剧情，不重写结构、不新增剧情；",
  "2. 台词口语化、短句为主，去掉解释性旁白；",
  "3. 补全每场的景别、镜头运动和镜头时长，确保可以直接出图；",
  "4. 只输出剧本正文，不要解释、不要复述要求。",
].join("\n");
const defaultPrompt = computed(() => (scriptTarget.value ? DEFAULT_EPISODE_PROMPT : DEFAULT_REWRITE_PROMPT));
// 整片是「初改」，分集是「精修」，两套要求分开存，切集不会互相覆盖。
function promptStorageKey() {
  return scriptTarget.value ? "markdirector.script.prompt.episode" : "markdirector.script.prompt";
}
const rewritePrompt = ref(localStorage.getItem("markdirector.script.prompt") ?? DEFAULT_REWRITE_PROMPT);

// ===== 节奏改写：独立文本、独立提示词、独立保存，与原地改写互不覆盖 =====
const beatText = ref("");
const beatDirty = ref(false);
// 三栏任一被手改都要能保存：按钮、未保存提示、各 run* 的落盘守卫统一看它。
const anyDirty = computed(() => scriptDirty.value || beatDirty.value || rewriteDirty.value);
const beatPrompt = ref(localStorage.getItem("markdirector.script.prompt.beat") ?? DEFAULT_BEAT_PROMPT);
const promptMode = ref<"beat" | "rewrite">("rewrite");
const activePrompt = computed({
  get: () => (promptMode.value === "beat" ? beatPrompt.value : rewritePrompt.value),
  set: (value: string) => { if (promptMode.value === "beat") beatPrompt.value = value; else rewritePrompt.value = value; },
});

type TextModelItem = { providerId: string; providerLabel: string; modelId: string; label: string };
const textModels = ref<TextModelItem[]>([]);
const modelsLoading = ref(false);
const modelsLoaded = ref(false);
const rewriteModel = ref(localStorage.getItem("markdirector.script.model") ?? "");
// ACT: 改写状态按目标（整片 / 每集）分别记录，整片与多集可以同时跑，切集也不会串状态。
type RewriteTask = { stage: string; steps: number };
const rewriteTasks = ref<Record<string, RewriteTask>>({});
// 节奏改写跑在独立 target 上，进度条与按钮状态也要跟着它走。
const activeTaskTarget = computed(() => {
  if (isTaskRunning("__beat__")) return "__beat__";
  if (isTaskRunning("__storyboard__")) return "__storyboard__";
  return scriptTarget.value;
});
const currentTask = computed(() => rewriteTasks.value[activeTaskTarget.value]);
const rewriting = computed(() => !!currentTask.value);
const promptOpen = ref(false);
const promptCustomized = computed(() => {
  if (promptMode.value === "beat") return beatPrompt.value.trim() !== DEFAULT_BEAT_PROMPT.trim();
  return rewritePrompt.value.trim() !== defaultPrompt.value.trim();
});
const rewriteStageText = computed(() => currentTask.value?.stage || "正在启动 Agent…");
const rewriteStepCount = computed(() => currentTask.value?.steps ?? 0);
function isTaskRunning(target: string) {
  return !!rewriteTasks.value[target];
}
function patchTask(target: string, patch: Partial<RewriteTask>) {
  const base = rewriteTasks.value[target] ?? { stage: "", steps: 0 };
  rewriteTasks.value = { ...rewriteTasks.value, [target]: { ...base, ...patch } };
}
function dropTask(target: string) {
  if (!rewriteTasks.value[target]) return;
  const next = { ...rewriteTasks.value };
  delete next[target];
  rewriteTasks.value = next;
}

// ===== 剧本创作：整条链路的第一环，产出 script.md 原文，后面才是改写 → 拆集 → 制作 =====
const createOpen = ref(false);
const creating = ref(false);
const createStage = ref("");
const createIdea = ref("");
const createEpisodes = ref(1);
const createDuration = ref(60);
const createRequirement = ref(localStorage.getItem("markdirector.create.prompt") ?? "");
const DEFAULT_CREATE_PROMPT = [
  "写一部能直接开拍的竖屏短剧：",
  "1. 开场 3 秒进冲突，每集至少一个反转，结尾留钩子；",
  "2. 人物动机明确，台词口语化、短句为主，不用旁白解释；",
  "3. 每场写清场号、场景、时间（日/夜）、景别、角色动作表情和台词；",
  "4. 只输出剧本正文，不要解释、不要大纲、不要复述要求。",
].join("\n");

// ===== 改编路径：小说（文学语言）→ 剧本（视听语言），对应文档阶段 1 =====
// novel.md 存原文、script.md 只放结构化剧本，两种文体不再混装，②③ 才不会把叙述体当剧本改。
const DEFAULT_ADAPT_PROMPT = [
  "把小说 / 网文原文改编成可直接开拍的竖屏漫剧结构化剧本：",
  "1. 按场次拆分，每场写全：场号、场景（室内/室外、日/夜）、出场角色、场景描述（一句话、可视化，不写抽象情绪）、动作、台词、旁白/内心独白（单独标注）、本场情绪、本场钩子；",
  "2. 心理活动三选一转化：变成表情/动作、变成旁白字幕、变成自言自语的台词；不保留大段内心独白；",
  "3. 砍掉环境、服饰等冗余文学描写，只提炼成场景与人设关键词；保留核心冲突、名场面与人物关系；",
  "4. 台词口语化、短句为主，一句不超过 20 字，括号标注语气；每个动作必须是看得见的；",
  "5. 一场一个核心事件；固定场景集中写，方便后续生成场景资产库；",
  "6. 保留原著主线与结局，不新增原著没有的角色、不新增支线；",
  "7. 只输出剧本正文，不写修改说明、不复述要求；多集按「## 第01集 标题」分节，集号两位数连续、标题不超过 12 字。",
].join("\n");
const ADAPT_NEGATIVE = [
  "不要写成小说叙述体，不要保留大段文学描写与内心独白，不要抽象情绪词堆砌，不要长段台词，",
  "不要新增原著没有的角色，不要写无法可视化的情节。",
].join("\n");
const createMode = ref<"original" | "adapt">(localStorage.getItem("markdirector.create.mode") === "adapt" ? "adapt" : "original");
const novelText = ref("");

// ===== 长文本上下文预算：分批创作 + 状态锚点，防止后段爆窗 / 幻觉 / 剧情漂移 =====
// 事实依据：一回合要求 Agent 把最多 200 集写进单个 script.md，模型 maxOutputTokens 会截断后半段；
// 且创作环节没有任何人物表/伏笔/摘要锚点，同一会话还会被反复复用累积历史。
const NOVEL_PART_CHARS = 12000;   // 单个原文分片上限（字），Agent 每轮只读本批分片
const CREATE_BATCH_MAX = 5;
const createBatchSize = ref(2);    // 每批写几集
const createDoneEpisodes = ref(0); // 已完成集数（跨刷新保留）
const createBatchIndex = ref(0);   // 已完成的批次数

function createStateKey() {
  return `markdirector.create.progress:${directory.value.replace(/\\/g, "/").toLowerCase()}`;
}
// 创作进度落 localStorage：刷新 / 重开后能「继续下一批」，不会把已写的前半部丢掉。
function loadCreateProgress() {
  try {
    const raw = localStorage.getItem(createStateKey());
    if (!raw) return;
    const saved = JSON.parse(raw) as { done?: number; batch?: number; total?: number; batchSize?: number };
    if (typeof saved.done === "number" && saved.done >= 0) createDoneEpisodes.value = saved.done;
    if (typeof saved.batch === "number" && saved.batch >= 0) createBatchIndex.value = saved.batch;
    if (typeof saved.total === "number" && saved.total > 0) createEpisodes.value = saved.total;
    if (typeof saved.batchSize === "number" && saved.batchSize > 0) createBatchSize.value = Math.min(saved.batchSize, CREATE_BATCH_MAX);
  } catch { /* 忽略损坏的进度 */ }
}
function saveCreateProgress() {
  try {
    localStorage.setItem(createStateKey(), JSON.stringify({
      done: createDoneEpisodes.value, batch: createBatchIndex.value,
      total: createEpisodes.value, batchSize: createBatchSize.value,
    }));
  } catch { /* 隐私模式忽略 */ }
}
const totalBatches = computed(() => Math.max(1, Math.ceil(createEpisodes.value / Math.max(1, createBatchSize.value))));
const createFinished = computed(() => createDoneEpisodes.value >= createEpisodes.value);
const createProgressText = computed(() => {
  if (!createDoneEpisodes.value) return `共 ${createEpisodes.value} 集 · 分 ${totalBatches.value} 批 · 每批最多 ${createBatchSize.value} 集`;
  return `已完成 ${createDoneEpisodes.value}/${createEpisodes.value} 集 · 第 ${Math.min(createBatchIndex.value + 1, totalBatches.value)}/${totalBatches.value} 批`;
});
const novelCharCount = computed(() => novelText.value.length);

// 通用「长剧本上下文预算」：②③ 整片改写共用，避免整部剧一次性进上下文。
const CONTEXT_BUDGET_RULES = [
  "【长剧本上下文预算（必须遵守）】",
  "1. 剧本超过 12 集或 3 万字时，按「## 第NN集」分节逐集处理；每轮只把「当前集 + 创作状态.md（若存在）」放进上下文，不要把整部剧一次性读入或一次性重写；",
  "2. 严禁凭记忆补写没读到的集；集号、人物姓名与外貌锚点、身份关系、世界规则、伏笔状态一律以 创作状态.md / 原文为准，不得另编；",
  "3. 每处理完一集先把该集结果写回目标文件对应分节，再进入下一集；写盘后自己回读核对分节数与集号连续，缺集要补齐再结束；",
  "4. 不要在回复里复述整部剧本，只回一句完成确认；正文一律写文件。",
].join("\n");

// 小说按段落边界切片，单段过长再硬切；保持原文不丢字。
function splitNovel(content: string): string[] {
  const paragraphs = content.split(/\n\s*\n/);
  const parts: string[] = [];
  let buf = "";
  for (const para of paragraphs) {
    if (buf.length + para.length > NOVEL_PART_CHARS && buf.trim()) { parts.push(buf.trim()); buf = ""; }
    buf += (buf ? "\n\n" : "") + para;
    while (buf.length > NOVEL_PART_CHARS) {
      parts.push(buf.slice(0, NOVEL_PART_CHARS));
      buf = buf.slice(NOVEL_PART_CHARS);
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.length ? parts : [content];
}
// 前端实现「追加写」：服务端 write 只有覆盖，读失败时拒绝覆盖，避免抹掉前半部。
async function appendText(path: string, addition: string, separator = "\n\n") {
  const disk = await readTextChecked(path);
  if (!disk.ok) throw new Error(`无法读取 ${path}（${disk.error}），为防覆盖已有内容已停止`);
  const merged = disk.text.trim() ? `${disk.text.trimEnd()}${separator}${addition.trim()}` : addition.trim();
  await files().write(path, merged);
  return merged;
}

watch(createMode, value => {
  try { localStorage.setItem("markdirector.create.mode", value); } catch { /* 隐私模式忽略 */ }
});

// ===== ⑥–⑧ 后续环节：剧本页只做软提醒，不在这里生成内容 =====
const LATE_STAGES: Record<string, { title: string; where: string; checklist: string[] }> = {
  audio: {
    title: "⑥ 配音音频 · 软提醒",
    where: "不在剧本页生成。工作台画布里有「配音与音效」节点（audioGenerationNode / TTS），也可以用 MiniMax / 即梦做声音克隆后导入；字幕在剪辑软件里做。",
    checklist: [
      "按分镜表台词栏给每个角色固定一种音色，全剧不换；导入参考音色锁定人设",
      "语速跟情绪走：紧张钩子稍快、抒情对话舒缓、震惊台词留停顿；逐条导出并按镜头编号命名",
      "音效按分镜表挂载：基础（脚步/开门/风/心跳）、冲突（电光/爆炸/碎裂）、转场（咻/淡入/冲击）",
      "BGM：开篇强节奏抓停留、对话段落压低不盖人声、高潮鼓点加重、结尾戛然而止留 0.5–1s 埋钩子",
      "音量配比：人声 100%、音效 40%–65%、BGM 15%–30%",
      "字幕：圆润漫画字体、底部居中不挡人脸、黑色粗描边；内心独白用浅色气泡字幕",
    ],
  },
  edit: {
    title: "⑦ 剪辑合成 · 软提醒",
    where: "不在剧本页生成。工作台用「剪辑台Pro」（webEpisodeEditorProNode）与 videoComposer.timelineCompose 做多轨导出，也可以整包丢给剪映专业版 / CapCut。",
    checklist: [
      "五轨道分层：① 视频层 ② 人物/特效层 ③ 配音层 ④ 音效层 ⑤ BGM 层，按分镜表顺序拼接",
      "对话正反打硬切；场景切换用淡入淡出、轻微闪白或漫画翻页转场；镜头切换卡在台词停顿或音效节点",
      "每段镜头首尾加少量缓慢推镜，避免画面死板",
      "全剧套同一套 LUT：对比度轻拉、饱和度 +5~+12、轻微暗角、轻锐化保留漫画线条",
      "封面：高冲突单镜 + 大字标题 + 钩子文案（按项目画幅）；片头 1–2 秒 IP，片尾引导追更",
    ],
  },
  qc: {
    title: "⑧ 消重质检发布 · 软提醒",
    where: "不在剧本页生成。去 AI 指纹、变速、调色和导出建议交给外部工具（剪映 / CapCut / FFmpeg）；发布文案已经写在本集 publish.md，可在「查看 / 复制」里调出。",
    checklist: [
      "去 AI 指纹：极淡胶片颗粒与噪点、边角轻微暗角、极小色彩偏移、BGM 开头偏移 0.2s、整体 ±0.5% 变速、自定义调色预设",
      "成片质检：人物全程无变脸、镜头时长匹配分镜脚本、台词与嘴型/动作贴合、无畸形肢体与诡异眼睛、无水印文字 logo、人声无爆音且 BGM 不压台词",
      "节奏验收：开头 3s 抓眼球、末尾留悬念、画风统一无跳写实/跳厚涂",
      "导出：按项目画幅设置分辨率（9:16 用 1080×1920、16:9 用 1920×1080），30 或 60 fps、高码率、MP4 无水印",
      "发布：悬念钩子标题、高冲突封面、埋钩子的 80–120 字简介、5–8 个话题标签、置顶评论、AI 生成标注",
    ],
  },
};
function showLateStage(key: string) {
  const stage = LATE_STAGES[key];
  if (!stage) return;
  const html = [
    `<p style="margin:0 0 10px;line-height:1.7">${stage.where}</p>`,
    '<p style="margin:0 0 6px;font-weight:600">检查清单</p>',
    '<ol style="margin:0;padding-left:20px;line-height:1.8">' + stage.checklist.map(item => `<li>${item}</li>`).join("") + '</ol>',
    '<p style="margin:12px 0 0;color:var(--el-text-color-secondary);font-size:12px">完整清单同时会写进本集 publish.md 的「后续环节检查清单」，做完 ⑤ 之后可以在「查看 / 复制」里对照。</p>',
  ].join("");
  void ElMessageBox.alert(html, stage.title, { dangerouslyUseHTMLString: true, confirmButtonText: "知道了", customClass: "lateStageBox" });
}

// 整片视角显示八步：①–⑤ 在剧本页执行，⑥–⑧ 是后续环节软提醒（去工作区 / 外部工具完成）。
const flowSteps = computed(() => {
  const hasScript = !!scriptText.value.trim();
  const hasBeat = !!beatText.value.trim();
  const hasRewrite = !!rewriteText.value.trim();
  const hasEpisodes = episodes.value.length > 0;
  const beatBusy = isTaskRunning("__beat__");
  const steps = [
    { key: "create", label: "剧本创作", hint: hasScript ? "已有剧本" : "原创 / 小说改编", tip: "① 写 script.md：原创从一句话点子写；改编番茄小说 / 原创小说要切「改编」模式，原文存 novel.md、改编结果写 script.md。多集必须按「## 第01集 标题」分节", done: hasScript, disabled: creating.value || rewriting.value || beatBusy, soft: false },
    { key: "beat", label: "节奏改写", hint: hasBeat ? "已有节奏稿" : hasRewrite ? "已跳过（可补做）" : "改快节奏", tip: "② 读 script.md → 写 beat.md（中栏节奏稿）：唯一允许改结构的环节，删拖沓场次、合并过场、调顺序，开场 3 秒进冲突、中段起冲突与反转、结尾留悬念；保留人设与主线，不新增支线", done: hasBeat, disabled: !hasScript || creating.value || rewriting.value || beatBusy, soft: false },
    { key: "rewrite", label: "分镜改写", hint: hasRewrite ? "已有分镜稿" : "改成分镜脚本", tip: "③ 优先读 beat.md（没有则 script.md）→ 写 rewrite.md（右栏）：按场拆段，标注场号、场景、日夜、景别、镜头运动、动作表情与台词；这一层严禁增删场次或改结构", done: hasRewrite, disabled: (!hasScript && !hasBeat) || creating.value || rewriting.value || beatBusy, soft: false },
    { key: "split", label: "按集拆分", hint: hasEpisodes ? `${episodes.value.length} 集` : "拆成独立分集", tip: "④ 按 rewrite.md → beat.md → script.md 的优先级取终稿 → 建 episodes/NN-标题/ 分集目录，每集自带剧本与画布", done: diskEpisodeDirs.value === null ? hasEpisodes : diskEpisodeDirs.value > 0, disabled: creating.value || rewriting.value || beatBusy || (!hasScript && !hasBeat && !hasRewrite), soft: false },
    { key: "produce", label: "分集制作", hint: hasEpisodes ? "逐集进画布" : "先拆分", tip: "⑤ 先在「全剧文档」生成资产提示词库，再逐集点「生成分镜表 / 节拍表」验收镜头与时长，最后「交给工作区制作」按表出图出视频；还没按集拆分时点这里会先给跳步提醒", done: false, disabled: false, soft: false },
    { key: "audio", label: "配音音频", hint: "画布 / 外部", tip: "⑥ 配音、音效、BGM、字幕：画布有配音节点，也可导出到剪映 / MiniMax；点开看检查清单（不在这里生成）", done: false, disabled: false, soft: true },
    { key: "edit", label: "剪辑合成", hint: "剪辑台Pro", tip: "⑦ 五轨道拼接、转场、统一调色、封面片头片尾：用剪辑台Pro 或剪映专业版；点开看检查清单（不在这里生成）", done: false, disabled: false, soft: true },
    { key: "qc", label: "质检发布", hint: "消重 / 导出", tip: "⑧ 去 AI 指纹、逐项质检、1080×1920 导出、发布文案：建议交给外部工具；点开看检查清单（不在这里生成）", done: false, disabled: false, soft: true },
  ];
  // ⑥–⑧ 是软提醒，不参与「当前该做哪一步」的判断。
  const firstUndone = steps.findIndex(step => !step.done && !step.soft);
  return steps.map((step, index) => ({ ...step, current: index === (firstUndone < 0 ? steps.length - 1 : firstUndone) }));
});

// ===== 防误触 / 跳步软提醒 =====
// 这两项不属于「第一步」的三件事，是按用户拍板后单独补的：
// 1) ②③ 已有产出时，再点一次先确认，不再一点就重跑覆盖；
// 2) 跳过节奏改写、或没拆集就要制作，给软提醒（说清后果，但仍允许继续）。
async function confirmRerun(label: string, current: string, path: string): Promise<boolean> {
  const disk = await readTextChecked(path);
  if (!disk.ok) {
    // 读不到磁盘时无法判定有没有旧产出：一律先确认，绝不静默覆盖。
    return ElMessageBox.confirm(
      `无法读取磁盘上的「${label}」（${disk.error}），不能确认是否已有旧内容。<br><br>继续会重新跑 Agent 并可能覆盖已有结果；建议先取消，检查项目目录与连接后再试。旧结果会自动留档到 history/。`,
      `无法确认 ${label} 是否已有内容`,
      { dangerouslyUseHTMLString: true, type: "warning", confirmButtonText: "仍然重新生成", cancelButtonText: "取消" },
    ).then(() => true, () => false);
  }
  if (!current.trim() && !disk.text.trim()) return true;
  return ElMessageBox.confirm(
    `已经有「${label}」了。再点一次会重新跑 Agent 并覆盖现有内容（覆盖前旧稿会自动备份到 history/）。<br><br>如果只是想看结果，点「取消」去「查看 / 复制」里看；确实要重跑再点「重新生成」。`,
    `重新生成 ${label}？`,
    { dangerouslyUseHTMLString: true, type: "warning", confirmButtonText: "重新生成", cancelButtonText: "取消" },
  ).then(() => true, () => false);
}

async function confirmSkipStep(title: string, message: string, confirmText: string, cancelText: string): Promise<boolean> {
  return ElMessageBox.confirm(message, title, {
    dangerouslyUseHTMLString: true, type: "warning", confirmButtonText: confirmText, cancelButtonText: cancelText,
  }).then(() => true, () => false);
}

async function runFlowStep(key: string) {
  if (key === "create") return openCreate();
  if (key === "beat") { void runBeat(); return; }
  if (key === "rewrite") { void runRewrite(); return; }
  if (key === "split") { void openSplit(); return; }
  if (key === "audio" || key === "edit" || key === "qc") { showLateStage(key); return; }
  // ⑤ 没拆集就要制作：给软提醒，而不是静默禁掉按钮。
  if (key === "produce" && !episodes.value.length) {
    const ok = await confirmSkipStep(
      "还没按集拆分，就要制作？",
      "第④步「按集拆分」还没做，现在没有分集目录；「交给工作区制作」只能在分集界面逐集进行。<br><br>建议先拆分，再从剧集列表进入某一集制作。",
      "仍然去看剧集列表", "先去按集拆分",
    );
    if (!ok) { void openSplit(); return; }
  }
  tab.value = "episodes";
}

function openCreate() {
  if (creating.value || rewriting.value) return;
  createOpen.value = true;
  if (!rewriteModel.value) void loadTextModels();
}

// ===== 制作文档：企划案 / 资产提示词库 =====
// 规范固化在这里：即使不挂任何题材模板，Agent 也必须产出整套能直接复制去抽卡的提示词。
const ASSET_SPEC = [
  "【资产卡通用规范（每张卡都要照抄，提示词必须整块可复制）】",
  "- 风格定调图：STYLE01 定今生正常色调、STYLE02 定前世/回忆低饱和冷调，各给一整块完整提示词；",
  "- 人物前缀：现代写实国漫角色设定图，电影级2.5D动画质感，成熟写实动漫比例，细腻五官与发丝，真实服装面料，柔和均匀的影棚光，中性浅灰纯色背景",
  "- 道具前缀：现代写实国漫道具设定图，电影级2.5D渲染质感，单主体居中，真实材质与使用痕迹，45度俯视，柔和影棚光，中性深灰纯色背景，无品牌标识",
  "- 场景前缀：现代写实国漫场景概念图，电影级2.5D环境绘制，真实空间透视与纵深，无人物，无品牌标识，按项目正片画幅构图",
  "- 人物负面词：多余手指，五官扭曲，比例失调，Q版，卡通，真人实拍，塑料皮肤，磨皮滤镜，网红脸，锥子脸，欧式大双眼皮，美瞳，品牌标识，文字，水印，复杂背景",
  "- 资产图画幅三档：人物立绘/状态卡/场景卡按项目正片画幅（通常 9:16），三视图 16:9，道具 1:1（大型道具可用正片画幅或 16:9）；不要写 3:4、4:3、2:1 等非标比例",
  "- 命名：资产类型_编号_状态_集数，例如 人物_P01_今生通勤装_E01",
  "- 非现代题材时，把三套前缀里的风格词换成该题材的美术定位，结构和负面词保持不变。",
  "",
  "【必须产出的卡（每张卡下面都要有一整块可直接复制的提示词）】",
  "1. 人物卡 P01起：人物描述（年龄/气质/身高/不变锚点）、三视图（16:9横构图，正面侧面背面同排等距）、表情四态（9:16胸部以上特写）、服装卡（9:16全身立绘，标使用集数）、状态卡（前世/今生、受伤等，标使用集数）、一致性锚点3-4个；",
  "2. 道具卡 D01起：主卡 + 状态卡，标使用集数；有结构的写清连接关系和尺寸；",
  "3. 场景卡 S01起：空景卡（无人物，定空间）+ 剧情机位卡（带构图和光效），标光效基调与复用集数；同一地点不同区域分别编号；",
  "4. 特效卡 FX01起：只做转场/重生瞬间等，统一纯黑背景便于合成，表格列提示词要点与使用集数；",
  "5. 生成顺序：人物 → 道具 → 场景 → 特效，文件末尾给一张总索引表。",
].join("\n");

const PLAN_SPEC = [
  "【企划案必须包含 13 项】",
  "1. 核心创意与商业卖点（3-5个卖点 + 强传播名场面）",
  "2. 完整故事梗概",
  "3. 世界规则与关键设定（时间线、能力/金手指规则与限制）",
  "4. 主要人物与关系（身份、外貌、弧光、配角首次出场集数、全角色身高表、主角服装线）",
  "5. 篇章主线与阶段高潮（表格）",
  "6. 逐集剧情与结尾钩子（每集2-3句 + 一句悬念，付费卡点集标「卡点」）",
  "7. 商业节奏（名场面表、单集节奏、快慢集）",
  "8. 伏笔与回收（表格）及连续性规则",
  "9. 视觉方案（美术定位、主色区分）",
  "10. 进度表（逐集目标 / 冲突 / 对手损失）",
  "11. 地点与空间（主要地点布局表、场景尺寸表）",
  "12. 声音设计（角色音色表、主题曲方案）",
  "13. 制作与发布（资产图→分镜图→视频→配音→剪辑字幕流程、平台、更新节奏、卡点集、合规）",
].join("\n");

const docRunning = ref<"" | "plan" | "assets">("");
const docTopic = ref(localStorage.getItem("markdirector.deliverable.topic") ?? "");
const docViewOpen = ref(false);
const docViewKey = ref("assets");
const docViewText = ref("");
type HistoryItem = { key: string; label: string; path: string; restorePath: string };
const historyItems = ref<HistoryItem[]>([]);
async function loadHistory() {
  try {
    const { entries } = await files().list("history");
    historyItems.value = entries
      .filter(entry => entry.type === "file" && /\.(md|json|txt)$/i.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 30)
      .map(entry => {
        const flat = entry.name.split("--").slice(2).join("--");
        return {
          key: `hist:${entry.name}`,
          label: `备份 · ${entry.name}`,
          path: `history/${entry.name}`,
          restorePath: flat.replace(/__/g, "/"),
        };
      });
  } catch { historyItems.value = []; }
}
// 题材模板的 frontmatter 只有英文 name，但 description 开头就是中文题材名，
// 例如「现代重生复仇AI漫剧全流程模板：…」。前端提取中文短名做显示，
// 英文 id 保留在括号里便于对照 /skill: 名称；不改动 21 个 SKILL.md 与服务端。
function skillCnName(item: { name: string; displayName: string; description?: string }) {
  if (/[\u4e00-\u9fff]/.test(item.displayName ?? "")) return item.displayName.trim();
  if (/-manju$/i.test(item.name ?? "")) {
    const head = (item.description ?? "").split(/[：:]/)[0].trim();
    const short = head.replace(/AI漫剧[\s\S]*$/, "").replace(/全流程模板$/, "").replace(/模板$/, "").trim();
    if (short && /[\u4e00-\u9fff]/.test(short)) return short;
  }
  return item.name;
}
function skillLabel(item: { name: string; displayName: string; description?: string }) {
  const cn = skillCnName(item);
  return cn === item.name ? item.name : `${cn}（${item.name}）`;
}

// 21 个题材模板都叫 xxx-manju，优先只列题材；列表还没加载时退回全部技能。
const topicSkills = computed(() => {
  const topics = produceSkills.value.filter(item => /manju/i.test(item.name));
  return topics.length ? topics : produceSkills.value;
});
const docViewItems = computed(() => {
  const items = [
    { key: "novel", label: "小说原文 novel.md", path: "novel.md" },
    { key: "novelIndex", label: "原文分片索引", path: "novel/index.md" },
    { key: "bible", label: "创作状态（一致性锚点）", path: "创作状态.md" },
    { key: "beat", label: "节奏稿 beat.md", path: "beat.md" },
    { key: "plan", label: "企划案", path: "企划案.md" },
    { key: "assets", label: "资产提示词库", path: "assets/资产库.md" },
  ];
  if (scriptTarget.value) {
    const base = scriptBase.value;
    items.push({ key: "storyboard", label: `${scriptLabel.value} · 分镜表`, path: `${base}分镜表.md` });
    items.push({ key: "beatsheet", label: `${scriptLabel.value} · 节拍表`, path: `${base}节拍表.md` });
    items.push({ key: "shots", label: `${scriptLabel.value} · 导演手册`, path: `${base}shots.md` });
    items.push({ key: "publish", label: `${scriptLabel.value} · 发布包`, path: `${base}publish.md` });
  }
  for (const item of historyItems.value) items.push({ key: item.key, label: item.label, path: item.path });
  return items;
});
watch(docTopic, value => {
  try { localStorage.setItem("markdirector.deliverable.topic", value); } catch { /* 隐私模式忽略 */ }
});
watch(docViewKey, () => { if (docViewOpen.value) void loadDocView(); });

function topicPrefix() { return docTopic.value ? `/skill:${docTopic.value} ` : ""; }

// 会话校验统一走这里：只有服务端明确说「不存在」才重建；网络错误 / 500 一律停手，
// 避免把 localStorage 里指向旧会话的 key 覆盖掉，导致历史对话找不回来。
async function ensureAgentSession(key: string, name: string): Promise<string | undefined> {
  const saved = localStorage.getItem(key) ?? "";
  if (saved) {
    try {
      const { data } = await axios.get<{ code: number }>("/api/agent/get", {
        params: { directory: directory.value, sessionFile: saved }, headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" },
      });
      if (data.code === 200) return saved;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      // 404 = 会话确实不在了；其它（断网、500、超时）不能当成「不存在」。
      if (status !== 404) throw new Error("无法校验 Agent 会话，已停止以免覆盖历史；请检查服务后重试");
      // 会话真丢了：留一份旧文件名索引，方便从 .agent/sessions 找回历史，而不是无声无息。
      try {
        const orphanKey = `${key}.orphans`;
        const list = JSON.parse(localStorage.getItem(orphanKey) ?? "[]") as string[];
        if (!list.includes(saved)) localStorage.setItem(orphanKey, JSON.stringify([...list, saved].slice(-20)));
      } catch { /* 忽略 */ }
    }
  }
  const { data } = await axios.post<{ code: number; data?: { file?: string } }>("/api/agent/create", { directory: directory.value }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } });
  const file = data.data?.file;
  if (!file) return undefined;
  localStorage.setItem(key, file);
  void axios.patch("/api/agent/rename", { directory: directory.value, sessionFile: file, name }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } }).catch(() => {});
  return file;
}

async function ensureDocSession(kind: string): Promise<string | undefined> {
  const key = `markdirector.deliverable.session:${kind}:${directory.value.replace(/\\/g, "/").toLowerCase()}`;
  const name = `${kind === "plan" ? "企划案" : "资产提示词库"} · ${meta.value?.name || directoryDisplayName(directory.value)}`;
  return ensureAgentSession(key, name);
}

function docIntro(task: string) {
  return [
    `【${task}生成任务】`,
    `项目：${meta.value?.name || directoryDisplayName(directory.value)}`,
    `视觉风格：${meta.value ? projectStyleName(meta.value.style) : "未设置"}`,
    `正片画幅：${filmAspect.value}`,
    `规模：共 ${episodes.value.length || createEpisodes.value} 集`,
    "",
    "【素材来源】",
    "先读取项目根目录的 beat.md、rewrite.md、script.md（以及 企划案.md，若存在）；剧情、场次顺序与结尾钩子以 beat.md / rewrite.md 为准（节奏改写会删并场次、调顺序），script.md 只用来补齐原文细节；把出场人物、地点、关键道具全部提取出来，一个不漏；",
    ...(docTopic.value ? [`本任务指定题材模板 ${docTopic.value}：先用 skillOperator 或 read 读取它的 SKILL.md，按里面的题材风格词与资产规范执行；`] : []),
    "不要凭空新增剧本里没有的角色或场景，但剧本里提到的每个角色、每个地点、每件关键道具都必须建成卡。",
    "",
  ];
}

function buildPlanPrompt() {
  return topicPrefix() + [
    ...docIntro("企划案"),
    PLAN_SPEC,
    "",
    "【执行方式】",
    "1. 逐集钩子必须和 beat.md / rewrite.md（没有则 script.md）的实际剧情一致，不能另编；",
    "2. 台词或剧情里提到的人物必须都在人物表里；",
    "3. 把完整企划案写入 企划案.md（覆盖写入，只写成品内容，不要解释）；",
    "4. 只写这一个文件，不要创建画布、不要生成图片、不要改动剧本；",
    "5. 完成后只回复一句「已写入 企划案.md」。",
  ].join("\n");
}

function buildAssetPrompt() {
  return topicPrefix() + [
    ...docIntro("全季资产提示词库"),
    ASSET_SPEC,
    "",
    "【执行方式】",
    "1. 每张卡先写描述表，再单独用代码块给一整块可直接复制的提示词（前缀 + 具体外貌/材质/构图 + 负面词），不要在提示词里写「同前」「参考上文」「按上表」这类要用户自己拼的省略；",
    "2. 提示词里不要出现编号占位或解释性文字，复制粘贴就能直接出图；",
    "3. 每张卡的编号、状态码、使用集数写清楚，后面分集导演手册会直接引用，跨集不得变更；",
    "4. 文件末尾给一张「参考图上传顺序总表」：按 人物 → 道具 → 场景 → 特效 的生成顺序，给每张需要出图的资产卡连续编号 R01、R02、R03…，并标出对应卡号；这张表就是画布里参考图的上传与连线顺序，shots.md 的 {{ref N}} / {{Mixed N}} 按 R 编号对齐；",
    "5. 写入前先确认 assets/ 目录存在（不存在就创建），再把完整资产库写入 assets/资产库.md（覆盖写入）；",
    "6. 只写这一个文件，不要创建画布、不要生成图片、不要改动剧本；",
    "7. 完成后只回复一句「已写入 assets/资产库.md」。",
  ].join("\n");
}

// ACT: 企划案与资产库各用一条独立会话，不污染改写/制作会话；生成后自动打开查看面板，提示词当场可复制。
async function runDeliverable(kind: "plan" | "assets") {
  if (docRunning.value) return;
  if (!textModels.value.length) await loadTextModels();
  const model = currentModel();
  if (!model) return ElMessage.warning("还没有可用的文本模型，请先在设置里配置");
  if (anyDirty.value) await saveScript();
  const path = kind === "plan" ? "企划案.md" : "assets/资产库.md";
  const label = kind === "plan" ? "企划案" : "资产提示词库";
  docRunning.value = kind;
  try {
    // assets/ 可能还不存在；服务端写文件不会自动建父目录。
    if (kind === "assets") await files().mkdir("assets").catch(() => {});
    await backupOutputs([path]);
    const sessionFile = await ensureDocSession(kind);
    const captured = await streamAgentRewrite(
      kind === "plan" ? buildPlanPrompt() : buildAssetPrompt(),
      sessionFile, model, `__doc_${kind}__`, () => {},
    );
    await settleWritten(path, captured);
    ElMessage.success(`${label}已生成，点「查看 / 复制」直接拿去抽卡`);
    await openDeliverables(kind);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : `${label}生成失败，请重试`);
  } finally {
    docRunning.value = "";
    dropTask(`__doc_${kind}__`);
  }
}

async function openDeliverables(key?: string) {
  if (key) docViewKey.value = key;
  // 分集视角默认打开本集导演手册，别停在整片的资产库上。
  else if (scriptTarget.value && !["storyboard", "beatsheet", "shots", "publish"].includes(docViewKey.value)) docViewKey.value = "shots";
  docViewOpen.value = true;
  await loadHistory();
  await loadDocView();
}

// 把自动备份的旧版本写回原路径；恢复前再备份一次当前内容，且立刻刷新三栏。
async function restoreDocView() {
  const item = historyItems.value.find(entry => entry.key === docViewKey.value);
  if (!item || !item.restorePath || !docViewText.value.trim()) return;
  const ok = await ElMessageBox.confirm(
    `把这份备份恢复到 <b>${item.restorePath}</b>？当前文件会被覆盖（覆盖前会再自动备份一次）。`,
    "恢复历史版本",
    { dangerouslyUseHTMLString: true, type: "warning", confirmButtonText: "恢复", cancelButtonText: "取消" },
  ).then(() => true, () => false);
  if (!ok) return;
  try {
    await backupOutputs([item.restorePath]);
    await files().write(item.restorePath, docViewText.value);
    scriptText.value = (await readTextChecked(`${scriptBase.value}script.md`)).text;
    rewriteText.value = (await readTextChecked(`${scriptBase.value}rewrite.md`)).text;
    if (!scriptTarget.value) beatText.value = (await readTextChecked("beat.md")).text;
    scriptDirty.value = false;
    beatDirty.value = false;
    rewriteDirty.value = false;
    ElMessage.success(`已恢复到 ${item.restorePath}，三栏已重新载入`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "恢复失败");
  }
}

async function loadDocView() {
  const item = docViewItems.value.find(entry => entry.key === docViewKey.value);
  docViewText.value = item ? await readText(item.path) : "";
}

async function copyDocView() {
  try {
    await navigator.clipboard.writeText(docViewText.value);
    ElMessage.success("已复制全文，可直接粘贴去出图");
  } catch {
    ElMessage.warning("复制被浏览器拦截，请直接在文本框里全选复制");
  }
}

// 制作技能：分集「交给工作区制作」时显式带上 /skill:名称，避免 Agent 跳过技能自己乱做。
const produceSkills = ref<{ name: string; displayName: string; description: string }[]>([]);
const produceSkill = ref(localStorage.getItem("markdirector.produce.skill") ?? "");
const produceSkillLoading = ref(false);

function modelKey(item: { providerId: string; modelId: string }) {
  return JSON.stringify([item.providerId, item.modelId]);
}

function currentModel() {
  return textModels.value.find(item => modelKey(item) === rewriteModel.value) ?? textModels.value[0];
}

const EPISODE_STAGES = [
  { key: "script", label: "剧本" },
  { key: "rewrite", label: "分镜" },
  { key: "canvas", label: "画布" },
  { key: "export", label: "成片" },
] as const;
type StageKey = typeof EPISODE_STAGES[number]["key"];
type StageMap = Partial<Record<StageKey, boolean>>;
// ACT: 阶段由分集目录里的实际文件推断，不额外存状态，避免档案与实际不一致。
const episodeStages = ref<Record<string, StageMap>>({});
// 磁盘上真实存在的分集目录数，用于校正 flowSteps ④ 的完成判定（project.json 可能与实际目录不一致）。
const diskEpisodeDirs = ref<number | null>(null);

function episodeStageText(episode: EpisodeMeta) {
  const stage = episodeStages.value[episode.id];
  if (!stage) return "读取中";
  return EPISODE_STAGES.filter(item => stage[item.key]).map(item => item.label).join(" → ") || "尚未开始";
}

async function loadEpisodeStages() {
  if (!directory.value || !meta.value) return;
  const client = files();
  const next: Record<string, StageMap> = {};
  // 用磁盘真实目录校正流程条 ④，不用 project.json 的记录数自欺。
  try {
    const root = await client.list("episodes");
    diskEpisodeDirs.value = root.entries.filter(entry => entry.type === "directory" && /^\d{2,3}-/.test(entry.name)).length;
  } catch { diskEpisodeDirs.value = null; }
  for (const episode of meta.value.episodes) {
    if (!episode.dir) { next[episode.id] = {}; continue; }
    // episode.json 不再只是写了不读：project.json 缺标题时用它补，避免分集显示空白。
    const own = await readTextChecked(`${episode.dir}/episode.json`);
    if (own.ok && !own.missing && !episode.title) {
      try { const parsed = JSON.parse(own.text) as { title?: string }; if (parsed.title) episode.title = parsed.title; } catch { /* 忽略损坏的分集元数据 */ }
    }
    const stage: StageMap = {};
    try {
      const { entries } = await client.list(episode.dir);
      const names = new Set(entries.map(entry => entry.name));
      stage.script = names.has("script.md");
      stage.rewrite = names.has("rewrite.md");
      stage.export = names.has("exports") || entries.some(entry => entry.type === "file" && /\.(mp4|mov|webm)$/i.test(entry.name));
      if (names.has("画布.json")) {
        try {
          const canvas = await client.readJson<{ nodes?: unknown[] }>(`${episode.dir}/画布.json`);
          stage.canvas = Array.isArray(canvas?.nodes) && canvas.nodes.length > 0;
        } catch { stage.canvas = false; }
      }
    } catch { /* 目录不可读时按未开始处理 */ }
    next[episode.id] = stage;
  }
  episodeStages.value = next;
}

const episodes = computed(() => meta.value?.episodes ?? []);
// 添加集 / 重命名 / 移除 / 改项目信息后都要重算阶段，否则新集一直显示「读取中」。
watch(() => (meta.value?.episodes ?? []).map(item => `${item.id}:${item.dir ?? ""}:${item.title}`).join("|"), () => { void loadEpisodeStages(); });
const assetTotal = computed(() => {
  const assets = meta.value?.assets;
  return assets ? assets.characters.length + assets.scenes.length + assets.props.length : 0;
});
const styleName = computed(() => meta.value ? projectStyleName(meta.value.style) : "");
const counters = computed(() => {
  const assets = meta.value?.assets;
  if (!assets) return "";
  const parts: string[] = [];
  if (assets.characters.length) parts.push(`${assets.characters.length} 角色`);
  if (assets.scenes.length) parts.push(`${assets.scenes.length} 场景`);
  if (parts.length) parts.push(`${episodes.value.length} 集`);
  else if (episodes.value.length) parts.push(`${episodes.value.length} 集`);
  return parts.join(" · ");
});
const scriptLabel = computed(() => {
  const episode = episodes.value.find(item => item.id === scriptTarget.value);
  return episode ? `${episode.id} · ${episode.title}` : "整片剧本";
});
const scriptDir = computed(() => episodes.value.find(item => item.id === scriptTarget.value)?.dir ?? "");
const scriptBase = computed(() => scriptDir.value ? `${scriptDir.value}/` : "");

function files() {
  return useWorkspaceFiles(directory.value);
}

// 制作技能：读项目可用技能，默认挑 workflow，没有就挑名字像制作流程的那个。
async function loadProduceSkills() {
  if (produceSkillLoading.value || !directory.value || produceSkills.value.length) return;
  produceSkillLoading.value = true;
  try {
    const { data } = await axios.get<{ data: Array<{ name: string; displayName: string; description: string }> }>("/api/agent/skills", {
      params: { directory: directory.value }, headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" },
    });
    produceSkills.value = data.data ?? [];
    if (!produceSkill.value) {
      const preferred = produceSkills.value.find(item => item.name === "workflow")
        ?? produceSkills.value.find(item => /workflow/i.test(item.name))
        ?? produceSkills.value.find(item => /制作|流程|分镜/.test(`${item.displayName}${item.description}`));
      if (preferred) produceSkill.value = preferred.name;
    }
  } catch { /* 技能列表读不到时按未指定处理 */ }
  finally { produceSkillLoading.value = false; }
}

function statusText(episode: EpisodeMeta) {
  return PROJECT_STATUS_TEXT[episode.status === "producing" ? "producing" : episode.status === "done" ? "done" : "idle"];
}

function episodeMetaText(episode: EpisodeMeta) {
  const parts: string[] = [];
  if (episode.duration) parts.push(`${episode.duration}s`);
  if (episode.resolution) parts.push(episode.resolution);
  const stage = episodeStages.value[episode.id];
  parts.push(!episode.dir ? "尚未建画布" : !stage ? "读取中" : stage.canvas ? "画布已就绪" : "画布待创作");
  return parts.join(" · ");
}

async function load() {
  if (!directory.value) { await router.replace("/home"); return; }
  error.value = "";
  const client = files();
  let raw: unknown = null;
  // project.json 读失败绝不能当成「文件不存在」：旧代码会用空档案覆盖，分集与资产元数据不可逆丢失。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      raw = await client.readJson(PROJECT_META_FILE);
      break;
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 404) { raw = null; break; } // 确实没有档案，才允许新建
      if (attempt === 2) {
        error.value = `读取 project.json 失败（${err instanceof Error ? err.message : "未知错误"}）；已停止，不会用空档案覆盖现有数据，请检查项目目录后重试`;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  try {
    meta.value = raw ? normalizeProjectMeta(raw, directoryDisplayName(directory.value)) : createProjectMeta(directoryDisplayName(directory.value));
    if (!raw) await saveMeta();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "读取项目档案失败";
  }
}

async function saveMeta() {
  if (!meta.value) return;
  await files().writeJson(PROJECT_META_FILE, meta.value);
}

onMounted(async () => {
  window.addEventListener("beforeunload", flushOnLeave);
  window.addEventListener("pagehide", flushOnLeave);
  await load();
  loadCreateProgress();
  // 首次进入就把整片三份文件读进来，否则 script.md / beat.md / rewrite.md 要手点一次「整片剧本」才出现。
  await selectScript("");
  await loadEpisodeStages();
  void loadTextModels();
  // 提前读技能目录，第一次点「交给工作区制作」就能带上正确的 /skill: 前缀。
  void loadProduceSkills();
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", flushOnLeave);
  window.removeEventListener("pagehide", flushOnLeave);
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (anyDirty.value) void saveScript(true);
});

function openAddEpisode() {
  draftTitle.value = "";
  addOpen.value = true;
  void nextTick(() => addInput.value?.focus());
}

function safeFolder(title: string) {
  return title.replace(/[\\/:*?"<>|\r\n\t]/g, "_").slice(0, 24).trim() || "未命名";
}

async function confirmAddEpisode() {
  const title = draftTitle.value.trim();
  if (!title || !meta.value || busy.value) return;
  busy.value = true;
  try {
    // 用现有最大集号 +1，而不是集数 +1：删过集之后按数量算会生成重复编号。
    const maxId = episodes.value.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
    const id = String(maxId + 1).padStart(2, "0");
    const dir = `episodes/${id}-${safeFolder(title)}`;
    const client = files();
    await client.mkdir("episodes").catch(() => {});
    await client.mkdir(dir).catch(() => {});
    await client.writeJson(`${dir}/episode.json`, { id, title, createdAt: Date.now(), status: "draft" }, true).catch(() => {});
    await client.writeJson(`${dir}/画布.json`, { markdirectorCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, true).catch(() => {});
    meta.value.episodes = [...meta.value.episodes, { id, title, dir, status: "draft" }];
    await saveMeta();
    addOpen.value = false;
    tab.value = "episodes";
    ElMessage.success(`第 ${Number(id)} 集已创建`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "创建分集失败");
  } finally {
    busy.value = false;
  }
}

// 按优先级匹配，宁可漏识别也不要错识别：只有「## 03」这种带 # 的裸编号才认，避免正文里的「03 回忆」被切开。
const SPLIT_PATTERNS = [
  /^\s*#{1,5}\s*(\d{1,3})\s*[、.．:：\-—·]?\s*(.{0,40})$/,
  /^\s*(?:#{1,5}\s*)?第\s*(\d{1,3})\s*[集话回]\s*[、.．:：\-—·]?\s*(.{0,40})$/,
  /^\s*(?:#{1,5}\s*)?(\d{1,3})[集话回]\s*[、.．:：\-—·]?\s*(.{0,40})$/,
  /^\s*(?:#{1,5}\s*)?(?:EP|E)\s*(\d{1,3})\b\s*[、.．:：\-—·]?\s*(.{0,40})$/i,
];

function cleanEpisodeTitle(raw: string, num: number) {
  const title = raw
    .replace(/^[\s《「“"'（(]+/, "")
    .replace(/[\s》」”"'）)]+$/, "")
    .replace(/[。，,、；;：:]+$/, "")
    .trim();
  return title || `第${num}集`;
}

// ACT: 只认行首、短行的集标记，避免把台词里的「第3集」误判成新的一集。
function parseScriptEpisodes(text: string): SplitItem[] {
  const lines = text.split(/\r?\n/);
  const marks: { index: number; id: string; num: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.length > 44) continue;
    const match = SPLIT_PATTERNS.map(pattern => line.match(pattern)).find(Boolean);
    if (!match) continue;
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num < 1 || num > 999) continue;
    marks.push({ index: i, num, id: String(num).padStart(2, "0"), title: cleanEpisodeTitle(match[2] ?? "", num) });
  }
  const existing = new Set((meta.value?.episodes ?? []).map(item => item.id));
  const items: SplitItem[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const from = marks[i].index + 1;
    const to = i + 1 < marks.length ? marks[i + 1].index : lines.length;
    const content = lines.slice(from, to).join("\n").trim();
    if (!content) continue;
    items.push({
      id: marks[i].id,
      title: marks[i].title,
      content,
      checked: !existing.has(marks[i].id),
      exists: existing.has(marks[i].id),
    });
  }
  return items;
}

const splitCheckedCount = computed(() => splitItems.value.filter(item => item.checked && !item.exists).length);
// 拆分取「最下游」的终稿：分镜稿 > 节奏稿 > 原文，保证前面所有改写都不白做。
// 拆分来源由磁盘实际文件决定（见 openSplit），不再依赖内存三栏，避免漏掉已落盘的终稿。
const splitSourceLabel = ref("原文 script.md");

async function openSplit() {
  if (splitLoading.value) return;
  splitLoading.value = true;
  try {
    // 手改未保存先落盘，避免读磁盘时漏掉刚改的内容。
    if (anyDirty.value) await saveScript();
    // 优先级 rewrite.md > beat.md > script.md，一律以磁盘为准。
    const candidates = [
      { label: "改写稿 rewrite.md", path: "rewrite.md" },
      { label: "节奏稿 beat.md", path: "beat.md" },
      { label: "原文 script.md", path: "script.md" },
    ];
    let source = "";
    for (const item of candidates) {
      const disk = await readTextChecked(item.path);
      if (disk.ok && !disk.missing) { source = disk.text; splitSourceLabel.value = item.label; break; }
    }
    if (!source.trim()) return ElMessage.warning("还没有内容可拆，先贴入或改写整片剧本");
    const parsed = parseScriptEpisodes(source);
    if (!parsed.length) {
      return ElMessage.warning("没识别到分集标记。请让整片剧本按「## 第01集 标题」的格式分节后再拆。");
    }
    splitItems.value = parsed;
    splitOpen.value = true;
  } finally {
    splitLoading.value = false;
  }
}

async function confirmSplit() {
  if (!meta.value || splitBusy.value) return;
  const targets = splitItems.value.filter(item => item.checked && !item.exists);
  if (!targets.length) return;
  splitBusy.value = true;
  try {
    const client = files();
    await client.mkdir("episodes").catch(() => {});
    // project.json 可能漏记（移除集会保留磁盘文件）：拆分前先看磁盘，已有正文先备份并确认，绝不静默覆盖。
    let diskIds = new Set<string>();
    try {
      const root = await client.list("episodes");
      diskIds = new Set(root.entries.filter(entry => entry.type === "directory").map(entry => entry.name.split("-")[0] ?? ""));
    } catch { /* 目录不可读时按项目档案判断 */ }
    for (const item of targets) {
      const dir = `episodes/${item.id}-${safeFolder(item.title)}`;
      const existing = await readTextChecked(`${dir}/script.md`);
      if (diskIds.has(item.id) && existing.ok && !existing.missing) {
        await backupOutputs([`${dir}/script.md`]);
        const ok = await ElMessageBox.confirm(
          `磁盘上已有第 ${item.id} 集的 script.md，但项目档案里没记这一集。继续会覆盖它（覆盖前已自动备份到 history/）。`,
          "覆盖磁盘上已有的分集",
          { type: "warning", confirmButtonText: "覆盖", cancelButtonText: "跳过这一集" },
        ).then(() => true, () => false);
        if (!ok) continue;
      }
      await client.mkdir(dir).catch(() => {});
      await client.write(`${dir}/script.md`, item.content);
      await client.writeJson(`${dir}/episode.json`, { id: item.id, title: item.title, createdAt: Date.now(), status: "draft" }, true).catch(() => {});
      await client.writeJson(`${dir}/画布.json`, { markdirectorCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, true).catch(() => {});
      meta.value.episodes.push({ id: item.id, title: item.title, dir, status: "draft" });
    }
    meta.value.episodes.sort((left, right) => Number(left.id) - Number(right.id));
    await saveMeta();
    await loadEpisodeStages();
    splitOpen.value = false;
    tab.value = "episodes";
    ElMessage.success(`已拆出 ${targets.length} 集，可以逐集进入制作`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "拆分失败，请重试");
  } finally {
    splitBusy.value = false;
  }
}

function rememberCanvas(path: string) {
  try { localStorage.setItem(`markdirector.canvas.last:${directory.value.replace(/\\/g, "/").toLowerCase()}`, path); } catch { /* 隐私模式忽略 */ }
}

async function enterEpisode(episode: EpisodeMeta) {
  if (!episode.dir) return;
  rememberCanvas(`${episode.dir}/画布.json`);
  await router.push("/workspace");
}

async function enterWhole() {
  rememberCanvas("画布1.json");
  await router.push("/workspace");
}

// 从剧本页直接回到当前这一集的画布，不用绕回剧集列表。
async function enterCurrentEpisode() {
  const episode = episodes.value.find(item => item.id === scriptTarget.value);
  if (episode) await enterEpisode(episode);
}

async function renameEpisode(episode: EpisodeMeta) {
  const result = await ElMessageBox.prompt("请输入本集标题", "重命名", {
    inputValue: episode.title, confirmButtonText: "保存", cancelButtonText: "取消",
    inputValidator: value => !!value?.trim() || "标题不能为空",
  }).catch(() => null);
  if (!result || !meta.value) return;
  episode.title = result.value.trim();
  await saveMeta().catch(() => {});
  if (episode.dir) await files().writeJson(`${episode.dir}/episode.json`, { ...episode, title: episode.title }, true).catch(() => {});
}

async function removeEpisode(episode: EpisodeMeta) {
  const ok = await ElMessageBox.confirm(`确定从项目里移除「${episode.title}」？磁盘上的分集文件会保留。`, "移除集", {
    type: "warning", confirmButtonText: "移除", cancelButtonText: "取消",
  }).then(() => true, () => false);
  if (!ok || !meta.value) return;
  meta.value.episodes = meta.value.episodes.filter(item => item.id !== episode.id);
  if (scriptTarget.value === episode.id) void selectScript("");
  await saveMeta().catch(() => {});
}

type ReadCheck = { ok: boolean; text: string; missing: boolean; error: string };
// 区分「文件不存在」与「读取失败」：后者绝不能当成空文件，否则会误判「无产出」而覆盖已有结果。
async function readTextChecked(path: string): Promise<ReadCheck> {
  try {
    const text = await files().readText(path);
    return { ok: true, text, missing: !text.trim(), error: "" };
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const body = axios.isAxiosError(err) ? (err.response?.data as { message?: string } | undefined)?.message ?? "" : "";
    if (status === 404 || (status === 400 && /不存在|not found|ENOENT/i.test(body))) {
      return { ok: true, text: "", missing: true, error: "" };
    }
    return { ok: false, text: "", missing: false, error: err instanceof Error ? err.message : "读取失败" };
  }
}
async function readText(path: string) {
  return (await readTextChecked(path)).text;
}
// 写前自动留档：会覆盖已有产出的动作先把旧文件复制到 history/，失败不阻断主流程。
async function backupOutputs(paths: string[]) {
  const client = files();
  try {
    await client.mkdir("history").catch(() => {});
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const path of paths) {
      const disk = await readTextChecked(path);
      if (!disk.ok || disk.missing) continue;
      // 路径压平成可还原的文件名：history/<时间>--<随机>--<原路径__压平>，恢复时把 __ 换回 /。
      const flat = path.replace(/\\/g, "/").replace(/\//g, "__");
      const target = `history/${stamp}--${crypto.randomUUID().slice(0, 6)}--${flat}`;
      await client.copy(path, target).catch(() => {});
    }
  } catch { /* 备份失败不影响主流程 */ }
}
// Agent 可能自己写盘：磁盘优先；读失败一律抛错，绝不拿空串把已有结果覆盖掉。
async function settleWritten(path: string, captured: string): Promise<string> {
  const disk = await readTextChecked(path);
  if (!disk.ok) throw new Error(`无法读取 ${path}（${disk.error}）；为防覆盖已有内容，本次结果暂不落盘，请检查后重试`);
  if (disk.text.trim()) return disk.text;
  const text = captured.trim();
  if (!text) throw new Error("Agent 没有返回内容，请检查模型或 CLI 是否可用");
  // 防止把「已写入 xxx」「完成」这类确认语当成正文写进空目标文件：
  // 这些产物都是多行长文，单行短句 / 过短内容一律视为无效结果，不落盘、不推进流程。
  const looksLikeAck = /^(?:已|已经|完成|写入|生成|保存|好的|ok|done|success|✓)/i.test(text) && text.length < 120;
  if (text.length < 40 || (!text.includes("\n") && (text.length < 120 || looksLikeAck))) {
    throw new Error(`Agent 返回的内容太短或只是确认语（${text.length} 字），没有把正文写进 ${path}；本次结果未落盘，请重试`);
  }
  await backupOutputs([path]);
  await files().write(path, captured);
  return captured;
}

let selectSeq = 0;
async function selectScript(id: string) {
  if (id === scriptTarget.value && !anyDirty.value) return;
  if (anyDirty.value && id !== scriptTarget.value) {
    const action = await ElMessageBox.confirm(
      `「${scriptLabel.value}」有未保存的修改（原文 / 节奏稿 / 分镜稿）。切换前要保存吗？`,
      "未保存的修改",
      { type: "warning", confirmButtonText: "保存并切换", cancelButtonText: "放弃修改并切换", distinguishCancelAndClose: true, closeOnClickModal: false },
    ).then(() => "save" as const, (reason: string) => reason === "cancel" ? "discard" as const : "stay" as const);
    if (action === "stay") return;
    if (action === "save") {
      await saveScript();
      if (anyDirty.value) return; // 保存失败不切换，避免静默丢改动
    }
  }
  const seq = ++selectSeq;
  scriptTarget.value = id;
  const base = id ? `${episodes.value.find(item => item.id === id)?.dir ?? ""}/` : "";
  const script = await readTextChecked(`${base}script.md`);
  if (seq !== selectSeq) return;
  // beat.md 是整片级文件；分集剧本由拆分从节奏稿生成，不另挂一份。
  const beat = id ? { ok: true, text: "", missing: true, error: "" } as ReadCheck : await readTextChecked("beat.md");
  if (seq !== selectSeq) return;
  const rewritten = await readTextChecked(`${base}rewrite.md`);
  if (seq !== selectSeq) return;
  scriptText.value = script.text;
  beatText.value = id ? "" : beat.text;
  rewriteText.value = rewritten.text;
  scriptDirty.value = false;
  beatDirty.value = false;
  rewriteDirty.value = false;
  // 整片用「初改」要求，分集用「精修」要求，各自记各自的自定义。
  rewritePrompt.value = localStorage.getItem(promptStorageKey()) ?? defaultPrompt.value;
  if (id) promptMode.value = "rewrite";
}

watch(rewriteModel, value => {
  try { localStorage.setItem("markdirector.script.model", value); } catch { /* 隐私模式忽略 */ }
});

watch(rewritePrompt, value => {
  try { localStorage.setItem(promptStorageKey(), value); } catch { /* 隐私模式忽略 */ }
});

watch(beatPrompt, value => {
  try { localStorage.setItem("markdirector.script.prompt.beat", value); } catch { /* 隐私模式忽略 */ }
});

watch(createRequirement, value => {
  try { localStorage.setItem("markdirector.create.prompt", value); } catch { /* 隐私模式忽略 */ }
});

watch(produceSkill, value => {
  try { localStorage.setItem("markdirector.produce.skill", value); } catch { /* 隐私模式忽略 */ }
});

function openScript(episode: EpisodeMeta) {
  tab.value = "script";
  void selectScript(episode.id);
}

// 用户手改三栏后自动落盘 + 离开页面兜底，避免刷新 / 关应用静默丢改动。
// 只监听 textarea 的 input，不监听 dirty 本身：Agent 流式回填也会置 dirty，不能被自动写盘打断。
let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
function onColumnInput(which: "script" | "beat" | "rewrite") {
  if (which === "script") scriptDirty.value = true;
  else if (which === "beat") beatDirty.value = true;
  else rewriteDirty.value = true;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { void saveScript(true); }, 1500);
}
function flushOnLeave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (anyDirty.value) void saveScript(true);
}

async function saveScript(silent = false) {
  if (!directory.value || !anyDirty.value) return;
  saving.value = true;
  try {
    if (scriptDirty.value) {
      await backupOutputs([`${scriptBase.value}script.md`]);
      await files().write(`${scriptBase.value}script.md`, scriptText.value);
      scriptDirty.value = false;
    }
    if (beatDirty.value && !scriptTarget.value) {
      await backupOutputs(["beat.md"]);
      await files().write("beat.md", beatText.value);
    }
    // 分集没有 beat 栏：残留标记随切换一起清掉，别让「未保存」一直亮着。
    beatDirty.value = false;
    if (rewriteDirty.value) {
      await backupOutputs([`${scriptBase.value}rewrite.md`]);
      await files().write(`${scriptBase.value}rewrite.md`, rewriteText.value);
      rewriteDirty.value = false;
    }
    if (!silent) ElMessage.success("剧本已保存");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存剧本失败");
  } finally {
    saving.value = false;
  }
}

async function loadTextModels() {
  if (modelsLoaded.value || modelsLoading.value) return;
  modelsLoading.value = true;
  try {
    const { data } = await axios.get<{ data: Array<TextModelItem & { protocol?: string }> }>("/api/ai/models");
    // 与对话面板保持一致：普通供应商和 CLI 引擎都列出来，改写统一走 /api/agent。
    textModels.value = (data.data ?? []).filter(item => item.providerId && item.modelId);
    if (!rewriteModel.value || !textModels.value.some(item => modelKey(item) === rewriteModel.value)) {
      const preferred = textModels.value[0];
      rewriteModel.value = preferred ? modelKey(preferred) : "";
    }
    modelsLoaded.value = true;
  } catch { /* 读取失败时按钮会提示 */ }
  finally { modelsLoading.value = false; }
}

function resetRewritePrompt() {
  if (promptMode.value === "beat") beatPrompt.value = DEFAULT_BEAT_PROMPT;
  else rewritePrompt.value = defaultPrompt.value;
}

function buildRewritePrompt(base = scriptBase.value, label = scriptLabel.value, useBeat = false) {
  const requirement = rewritePrompt.value.trim() || defaultPrompt.value;
  // 依据磁盘上真实的 beat.md（调用方读盘后传入），不再用内存 beatText，避免手改节奏稿后读旧文件。
  const source = useBeat ? "beat.md" : "script.md";
  const lines = [
    "【分镜改写任务】",
    `项目：${meta.value?.name || directoryDisplayName(directory.value)}`,
    `视觉风格：${meta.value ? projectStyleName(meta.value.style) : "未设置"}`,
    `正片画幅：${filmAspect.value}`,
    `目标：${label}`,
    "",
    "【任务层级】",
    "本任务属于「制作层」：只把已有剧本改写成可出分镜的场景脚本，不改剧情结构。增删场次、调顺序、改钩子已在上一环节 beat.md 定稿，这一步严禁再动。",
    "",
    "【改写要求】",
    requirement,
    "",
    CONTEXT_BUDGET_RULES,
    "",
    "【执行方式】",
    `1. 先读取 ${base}${source} 作为原文；`,
    "2. 严格按上面的改写要求处理，保留人物关系、场次顺序和关键情节，不要新增无关剧情；",
    `3. 把完整改写结果写入 ${base}rewrite.md（覆盖写入，只写剧本正文，不要解释）；`,
  ];
  if (!base) {
    // 整片必须能被「按集拆分」切开，所以强制统一集标记。
    lines.push("4. 原文包含多集时，必须按「## 第01集 标题」的格式分节输出：集号两位数且连续，标题不超过 12 字，不要用其它分集写法；");
    lines.push("5. 完成后只回复一句「已写入 rewrite.md」。");
  } else {
    lines.push("4. 完成后只回复一句「已写入 rewrite.md」。");
  }
  return lines.join("\n");
}

// ===== 节奏改写：读 script.md → 写 beat.md，是全流程唯一允许改结构的环节 =====
function buildBeatPrompt(base: string, label: string) {
  const requirement = beatPrompt.value.trim() || DEFAULT_BEAT_PROMPT;
  const lines = [
    "【节奏改写任务】",
    `项目：${meta.value?.name || directoryDisplayName(directory.value)}`,
    `视觉风格：${meta.value ? projectStyleName(meta.value.style) : "未设置"}`,
    `正片画幅：${filmAspect.value}`,
    `目标：${label}`,
    "",
    "【任务层级】",
    "本任务属于「内容层」：允许改结构（删场次、合并过场、调顺序、提前反转、改结尾钩子），这是全流程里唯一允许改结构的环节；",
    "后面的分镜改写、按集拆分与分集制作都严禁改剧情，所以节奏必须在这一步定稿。",
    "",
    "【节奏要求】",
    requirement,
    "",
    CONTEXT_BUDGET_RULES,
    "",
    "【执行方式】",
    `1. 先读取 ${base}script.md 作为原文；`,
    "2. 严格按上面的节奏要求重写，输出仍是完整剧本正文，不是修改说明、不是大纲、不是表格；",
    `3. 把完整节奏稿写入 ${base}beat.md（覆盖写入，只写剧本正文，不要解释、不要复述要求）；`,
    "4. 原文包含多集时，必须按「## 第01集 标题」分节：集号两位数且连续，标题不超过 12 字；每集结尾都要留钩子；",
    "5. 只写 beat.md 这一个文件，不要改 script.md / rewrite.md，不要创建画布、不要生成图片；",
    "6. 完成后只回复一句「已写入 beat.md」。",
  ];
  return lines.join("\n");
}

function beatSessionKey() {
  return `markdirector.beat.session:${directory.value.replace(/\\/g, "/").toLowerCase()}`;
}

// 节奏改写单独一条会话，不污染创作 / 改写 / 制作的历史。
async function ensureBeatSession(): Promise<string | undefined> {
  return ensureAgentSession(beatSessionKey(), `节奏改写 · ${meta.value?.name || directoryDisplayName(directory.value)}`);
}

async function runBeat() {
  // 只对整片生效；节奏改写与整片分镜改写互相依赖，不能同时跑。
  if (scriptTarget.value || isTaskRunning("__beat__") || isTaskRunning("")) return;
  const source = scriptText.value.trim();
  if (!source) return ElMessage.warning("还没有原文，先贴剧本或用第①步创作");
  // ② 已有节奏稿时先确认，避免误点一次就重跑覆盖。
  if (!(await confirmRerun("节奏稿 beat.md", beatText.value, "beat.md"))) return;
  if (!textModels.value.length) await loadTextModels();
  const model = currentModel();
  if (!model) return ElMessage.warning("还没有可用的文本模型，请先在设置里配置");
  if (anyDirty.value) await saveScript();
  const previous = beatText.value;
  await backupOutputs(["beat.md"]);
  patchTask("__beat__", { stage: "正在准备节奏改写…", steps: 0 });
  beatText.value = "";
  beatDirty.value = false;
  try {
    const sessionFile = await ensureBeatSession();
    const captured = await streamAgentRewrite(buildBeatPrompt(scriptBase.value, scriptLabel.value), sessionFile, model, "__beat__", text => {
      if (scriptTarget.value) return;
      beatText.value = text;
      beatDirty.value = true;
    });
    beatText.value = await settleWritten("beat.md", captured);
    beatDirty.value = false;
    ElMessage.success("节奏稿已写入 beat.md，下一步点流程第③步「分镜改写」");
  } catch (err) {
    if (!beatText.value.trim()) beatText.value = previous;
    ElMessage.error(err instanceof Error ? err.message : "节奏改写失败，请重试");
  } finally {
    dropTask("__beat__");
  }
}

// ===== 分镜表 / 节拍表：③ 之后、⑤ 之前的独立可验收产物（文档阶段 2）=====
// 制作指令改为「按表出图」，镜头编号、时长、景别、台词在这里定稿，不再在出图时临时拆。
const storyboardRunning = ref(false);
function buildStoryboardPrompt(base: string, label: string, hasRewrite: boolean) {
  const source = hasRewrite ? `${base}rewrite.md` : `${base}script.md`;
  const storyboard = `${base}分镜表.md`;
  const beatsheet = `${base}节拍表.md`;
  return [
    "【分镜表 / 节拍表生成任务】",
    `项目：${meta.value?.name || directoryDisplayName(directory.value)}`,
    `视觉风格：${meta.value ? projectStyleName(meta.value.style) : "未设置"}`,
    `正片画幅：${filmAspect.value}`,
    `目标：${label}`,
    `单集时长：约 ${createDuration.value} 秒（以剧本实际内容为准，镜头时长加总必须等于本集正片时长）`,
    "",
    "【任务层级】",
    `这是「节奏化改写」的表格化产物，位于 ③ 分镜改写之后、⑤ 交给工作区制作之前。读取 ${source} 作为唯一剧情依据，只做「场次 → 镜头」的拆分与定时长，严禁增删剧情、改台词、改结尾钩子。`,
    "",
    "【产出 1：分镜表.md】",
    "1. 一行一镜，编号 L01、L02… 连续；按场次顺序，每场 3-6 镜；",
    "2. 表头固定 15 列：镜头编号 | 时长 | 画幅 | 景别 | 机位 | 镜头运动 | 角色 | 角色动作 | 表情 | 场景 | 画面描述 | 台词 | 配音备注 | 音效 | BGM；每格都要填实，不要写「同前」「按上表」；",
    "3. 正片画幅一律 ${filmAspect.value}；景别用 特写/近景/中景/全景，机位用 平视/仰拍/俯拍/侧面，镜头运动用 固定/缓推/缓拉/平移/跟拍/急推/轻微震动；",
    "4. 画面描述写成可直接扩展成 AI 生图提示词的可视化关键词，只定一个静止瞬间；台词口语化短句，配音备注写语气与是否口型镜；内心独白只写音效并注明该角色闭口；",
    "5. 对话镜头用近景/中景正反打，情绪镜头用特写；角色/场景/道具沿用 assets/资产库.md 的 P/D/S/FX 编号（没有资产库时留空并注明）；",
    "6. 表末附「时长验算」：逐镜时长加总 = 本集正片时长，误差写清楚。",
    "",
    "【产出 2：节拍表.md】",
    "1. 按秒排布，表头：时间段 | 镜头 | 情绪/节奏 | 画面/台词要点 | 音效/BGM 节点；",
    `2. 按本集正片时长 T = ${createDuration.value} 秒分五段，每段写实数秒数且加总严格等于 T：0-3s 强钩子（高冲突画面 + 第一句台词 + 强节奏 BGM 起）；3s-${Math.round(createDuration.value * 0.15)}s 铺垫；${Math.round(createDuration.value * 0.15)}s-${Math.round(createDuration.value * 0.6)}s 冲突升级；${Math.round(createDuration.value * 0.6)}s-${Math.round(createDuration.value * 0.92)}s 高潮/反转；最后 ${Math.max(2, Math.round(createDuration.value * 0.08))}s 悬念钩子、音乐戛然而止；不要照抄示例秒数；`,
    "3. 标注对话正反打硬切点、冲突快切段、台词说完再切镜头、转场点与音乐起伏；",
    "4. 每个时间段引用分镜表里的 L 编号，不出现表里没有的镜头。",
    "",
    "【执行方式】",
    `1. 把分镜表写入 ${storyboard}（覆盖写入，只写表格与时长验算）；`,
    `2. 把节拍表写入 ${beatsheet}（覆盖写入，只写表格）；`,
    "3. 只写这两个文件，不要创建画布、不要生成图片或视频、不要改动剧本；",
    "4. 完成后只回复一句「已写入 分镜表.md / 节拍表.md」。",
  ].join("\n");
}

function storyboardSessionKey(target: string) {
  return `markdirector.storyboard.session:${target}:${directory.value.replace(/\\/g, "/").toLowerCase()}`;
}
async function ensureStoryboardSession(target: string): Promise<string | undefined> {
  return ensureAgentSession(storyboardSessionKey(target), `分镜表 · ${scriptLabel.value}`);
}

async function runStoryboard() {
  if (!scriptTarget.value || storyboardRunning.value || rewriting.value) return;
  const hasRewrite = !!rewriteText.value.trim();
  if (!hasRewrite && !scriptText.value.trim()) return ElMessage.warning("这一集还没有剧本");
  if (anyDirty.value) await saveScript();
  const base = scriptBase.value;
  // 与 ②③ 共用一套「已有产出先确认」，避免误点一次就覆盖定稿的分镜表。
  if (!(await confirmRerun("这一集的分镜表 / 节拍表", "", `${base}分镜表.md`))) return;
  if (!textModels.value.length) await loadTextModels();
  const model = currentModel();
  if (!model) return ElMessage.warning("还没有可用的文本模型，请先在设置里配置");
  await backupOutputs([`${base}分镜表.md`, `${base}节拍表.md`]);
  storyboardRunning.value = true;
  patchTask("__storyboard__", { stage: "正在拆分镜头与节拍…", steps: 0 });
  try {
    const sessionFile = await ensureStoryboardSession(scriptTarget.value);
    const captured = await streamAgentRewrite(buildStoryboardPrompt(base, scriptLabel.value, hasRewrite), sessionFile, model, "__storyboard__");
    await settleWritten(`${base}分镜表.md`, captured);
    // 节拍表是制作前的硬依据，缺了在这里就报，别等到出图才发现时间轴没定。
    const beats = await readTextChecked(`${base}节拍表.md`);
    if (!beats.ok || beats.missing) throw new Error("节拍表.md 没生成或读取失败，请重新生成分镜表 / 节拍表");
    ElMessage.success("分镜表 / 节拍表已生成，先在「查看 / 复制」里验收镜头与时长，再点「交给工作区制作」");
    await openDeliverables("storyboard");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "生成分镜表失败，请重试");
  } finally {
    storyboardRunning.value = false;
    dropTask("__storyboard__");
  }
}

// 分集「交给工作区制作」的提示词：按已定稿的分镜表出图，A/B 两段分别写进画布节点与 shots.md。
function buildProducePrompt(base: string, label: string, hasRewrite: boolean) {
  const source = hasRewrite ? `${base}rewrite.md` : `${base}script.md`;
  const storyboard = `${base}分镜表.md`;
  const beatsheet = `${base}节拍表.md`;
  // 首行用 /skill:名称 显式触发技能，Agent 会先读技能正文再动手，不再自己随意选流程。
  return `${produceSkill.value ? `/skill:${produceSkill.value} ` : ""}` + [
    "【分集制作任务】",
    `项目：${meta.value?.name || directoryDisplayName(directory.value)}`,
    `视觉风格：${meta.value ? projectStyleName(meta.value.style) : "未设置"}`,
    `正片画幅：${filmAspect.value}`,
    `目标：${label}`,
    "",
    "【制作底稿：分镜表已定稿，本步只按表出图】",
    `先读取 ${storyboard} 与 ${beatsheet} 作为镜头、时长、景别、机位、台词与节奏的唯一依据；再读取 ${source} 补齐画面细节与台词原文。`,
    `${storyboard} 不存在或为空时，停止制作并回复「请先回剧本界面点『生成分镜表 / 节拍表』验收镜头与时长后再制作」，不要自己重新拆镜头、不要另编镜头编号；`,
    "镜头编号 L01/L02…、时长、景别、机位、动作、台词、音效、BGM 一律照抄分镜表；节奏、钩子与反转已在整片「节奏改写」阶段定稿，本步严禁增删场次、调顺序或改结尾。",
    ...(hasRewrite ? [] : ["（这一集还没有终稿，画面细节按 script.md 补齐）"]),
    "",
    "【制作前必读：资产库是 A/B 段的参考图来源】",
    "1. 先读取 assets/资产库.md；文件不存在或为空时，停止制作并回复「请先回剧本界面点『生成资产提示词库』，出好资产图后再制作」，不要凭空编造 P/D/S/FX 编号；",
    "2. 资产库里每张卡对应一张已经出好的资产图（人物立绘/三视图、场景空景卡、道具卡、STYLE01/02 定调图）。这些图要先作为画布里的图片节点存在；用户尚未上传时，明确列出还缺哪几个 R 编号的图并暂停，不要用文字描述代替参考图；",
    "3. 按资产库末尾「参考图上传顺序总表」的 R 编号顺序，用 connectNodes 把资产图连到每个生成节点的参考端口；A/B 段里 {{ref N}} / {{Mixed N}} 的 N 必须等于该节点实际 refList 的顺序（连线/上传顺序），每换一个镜头都要重新核对，不能沿用上一镜的编号；",
    "",
    "【执行要求】",
    "1. 严格按分镜表的 L 编号顺序逐镜制作，不新增、不合并、不跳镜；沿用分镜表的镜头清单，补上生成方式、是否口型镜、首帧编号、参考图 R 编号，形成时间轴总表；时长加总必须等于分镜表「时长验算」的结果；",
    "2. 每个 L 编号必须写 A 段分镜图提示词和 B 段视频提示词，两块都要能整块复制，画面/景别/机位/动作/台词必须与分镜表该镜一致，不要写「同前」「参考上文」「按上表」；",
    "3. A 段分镜图提示词用五行结构：参考（STYLE01/02 + 角色状态码 + 场景空景卡 + 道具编号，按 R 编号写成 {{ref N}}）、画面（谁在画左画右、姿势、面朝哪边、道具状态、一个词的表情）、机位（焦段、方向与高度、景别、人物位置）、光线（来源与颜色）、风格（美术定位 + ${filmAspect.value}构图 + 无文字无水印）；只定一个静止瞬间，不写动作过程、不重写五官服装；",
    "4. B 段视频提示词按整块结构写：资产图锚定（角色/场景/道具各自 {{Mixed N}}，序号与实际连线顺序一致）、出场角色、背景场景、参考图使用规则、按动作起止分段（如 0-4秒 / 4-8秒，每段写画面 / 禁止 / 约束 / 站位与朝向 / 运镜 / 音效）、输出约束、最后一行 [视觉风格：… ${filmAspect.value}竖屏]；当场台词写进画面并注明口型对齐，内心独白只写音效并注明该角色闭口；",
    "5. 每镜附制作信息（生成方式、特效卡与合成时段、每句台词起止秒数、音乐、转场），并在手册末尾附一份连续性检查（越轴、道具状态、光线方向、状态卡不混用、时长验算、参考编号与实际连线是否一致）；",
    "6. 角色形象、P/D/S/FX 编号与 LOOK 状态码一律沿用 assets/资产库.md，跨镜头、跨集不得变更；",
    "7. 正片与分镜图画幅一律 ${filmAspect.value}；仅资产三视图用 16:9、道具用 1:1，不要写 3:4、4:3、2:1 等非标比例；",
    "",
    "【画布执行：A 段写图片节点，B 段写视频节点，两段都要落到节点上】",
    "1. 先用 getNodeTools 查询实际注册的函数与参数：imageGenerationNode 的 node:setPrompt / node:setConfig / node:generateImage，videoGenerationNode 的 node:setPrompt / node:setConfig；按查到的 schema 填 args，不要猜函数名或字段；addNode 只能传 type/position/label，提示词必须用 node:setPrompt 写；",
    "2. 每个镜头建两个节点（画布上已有同名镜号的空节点时直接复用、用 node:setPrompt 填入，不要重复新建），按场次从左到右、上下成对排列：",
    "   - 图片生成节点（A 段）：把该镜 A 段分镜图提示词用 node:setPrompt 整块写入；node:setConfig 设 ${filmAspect.value} 与 ${filmResolution.value}；资产图节点连到它的参考端口后调用 node:generateImage 出首帧分镜图；",
    "   - 视频生成节点（B 段）：把该镜 B 段视频提示词用 node:setPrompt 整块写入；node:setConfig 设 ${filmAspect.value} 与本镜时长；把刚出的首帧分镜图连到它作为首帧参考；先不要调用 node:generateVideo，等用户确认风格后由用户点生成，避免白跑额度；",
    "3. A 段与 B 段写进节点的文本，必须和 shots.md 里对应镜头的两段逐字一致，不能只写进文件却让画布节点留空；",
    "4. 先做第一场的 3 个镜头（每个镜头都要同时有 A 段图片节点和 B 段视频节点）给我确认风格，我说继续再批量做完。",
    "",
    ...(produceSkill.value ? [
      "",
      "【技能要求】",
      `本任务必须按 ${produceSkill.value} 技能执行：先用 skillOperator 或 read 读取它的 SKILL.md，按当前版本的流程与模板做；`,
      "不要跳过技能直接建节点，也不要把别的技能流程套进来。",
    ] : []),
    "",
    "【兜底】",
    "如果画布上没有可用的图片节点，或查不到 node:setPrompt，先把镜头清单与 A/B 两段完整写进文件并告诉我还缺哪个节点插件，不要空转、不要只写镜头清单；",
    "",
    "【完成后】",
    `把本集导演手册写入 ${base}shots.md：本集资产清单（含 R 编号对应表）+ 沿用 ${storyboard} / ${beatsheet} 的时间轴总表与节拍表 + 每镜的 A 段分镜图提示词 / B 段视频提示词 / 制作信息 + 连续性检查；不要只写镜头清单；`,
    `再写入 ${base}publish.md：封面提示词按 ${filmAspect.value} 与 16:9 两档各一整块（人物脸部朝镜头、位于画面中部偏上，留出标题位，标题字后期排版）、封面负面词、片尾卡 3 秒与下集预告 8-10 秒方案、3 个钩子标题、80-120 字简介、5-8 个话题标签、置顶评论、AI 生成标注与合规提示；`,
    "publish.md 末尾再附「后续环节检查清单」三节，对应流程条 ⑥⑦⑧：",
    "⑥ 配音音频：每角色固定音色全剧不换、逐条导出按镜号命名、音量配比（人声 100% / 音效 40%-65% / BGM 15%-30%）、圆润漫画字体字幕底部居中黑描边、内心独白用浅色气泡字幕；",
    "⑦ 剪辑合成：五轨道（视频/人物特效/配音/音效/BGM）、对话正反打硬切、全剧统一 LUT 与轻微暗角、封面 9:16 高冲突单镜 + 大字标题、片头 1-2 秒 IP 与片尾追更；",
    "⑧ 消重质检发布：极淡胶片颗粒与噪点、BGM 开头偏移 0.2s、整体 ±0.5% 变速、自定义调色预设；无变脸/无畸形/时长匹配分镜表/无水印文字/开头 3s 钩子与结尾悬念/画风统一；1080×1920、30 或 60 fps、高码率 MP4 无水印；钩子标题 + 80-120 字简介 + 5-8 个话题标签 + 置顶评论 + AI 生成标注；",
    "两个文件都只写成品提示词与文案，不要出现「待补充」「参考上文」这类占位。",
  ].join("\n");
}

// 整片与每集各用一条会话，才能并行改写；同一集复用上次的会话，删了再重建。
function rewriteSessionKey(target: string) {
  const scope = target ? `episode-${target}` : "whole";
  return `markdirector.script.session:${scope}:${directory.value.replace(/\\/g, "/").toLowerCase()}`;
}

async function ensureRewriteSession(target: string): Promise<string | undefined> {
  const episode = episodes.value.find(item => item.id === target);
  const name = target ? `剧本改写 · ${episode ? `${episode.id} ${episode.title}` : target}` : "剧本改写 · 整片";
  return ensureAgentSession(rewriteSessionKey(target), name);
}

// 读 /api/agent 的 NDJSON 事件流：文本块累积到右侧编辑区，工具事件只当作进度。
async function streamAgentRewrite(prompt: string, sessionFile: string | undefined, model: TextModelItem, target: string, applyText?: (text: string) => void) {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" },
    body: JSON.stringify({
      prompt, directory: directory.value, runId: crypto.randomUUID(),
      providerId: model.providerId, modelId: model.modelId, sessionFile,
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(detail?.message || `Agent 请求失败（${response.status}）`);
  }
  if (!response.body) throw new Error("未收到 Agent 响应流");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const blocks = new Map<string, string>();
  const seenTools = new Set<string>();
  let pending = "";
  let failure = "";
  let malformed = 0;
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let event: { type?: string; blockId?: string; delta?: string; content?: string; message?: string; tool?: { id?: string; name?: string; status?: string } };
    try { event = JSON.parse(line); } catch { malformed += 1; return; }
    if (event.type === "text" && event.blockId) {
      blocks.set(event.blockId, event.content ?? `${blocks.get(event.blockId) ?? ""}${event.delta ?? ""}`);
      const current = [...blocks.values()].join("\n\n");
      // 创作走 applyText 回填左栏；改写仍回填右栏，并跟随当前选中的剧本。
      if (applyText) applyText(current);
      else if (scriptTarget.value === target) {
        rewriteText.value = current;
        rewriteDirty.value = true;
      }
    } else if (event.type === "tool" && event.tool) {
      // ACT: 把 Agent 的工具调用显示出来，避免原地改写变成黑盒转圈；进度按目标各记各的。
      const toolId = event.tool.id || event.tool.name || "";
      const steps = (rewriteTasks.value[target]?.steps ?? 0) + (toolId && !seenTools.has(toolId) ? 1 : 0);
      if (toolId) seenTools.add(toolId);
      patchTask(target, { stage: `正在执行 ${event.tool.name || "工具"}`, steps });
    } else if (event.type === "error") {
      failure = event.message || "Agent 运行失败";
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    }
    // 最后一帧可能没有换行结尾：以前直接丢掉，长文本结尾会被截掉一截。
    if (pending.trim()) handleLine(pending);
  } finally { reader.releaseLock(); }
  if (failure) throw new Error(failure);
  const result = [...blocks.values()].join("\n\n").trim();
  // 一行都没解析成功却收到数据：不要把「流异常」当成「Agent 什么都没返回」。
  if (!result && malformed > 0) throw new Error(`Agent 响应流有 ${malformed} 行无法解析，结果可能不完整，请重试`);
  return result;
}

// ACT: 原地改写统一走 /api/agent，和对话 Agent 同一套模型、技能与内置提示词，不再直连 /api/ai/generate。
async function runRewrite() {
  // 只阻止同一集重复提交；别的分集或整片正在改写时仍可同时开始。
  if (storyboardRunning.value || creating.value || docRunning.value) return;
  if (isTaskRunning(scriptTarget.value) || (!scriptTarget.value && isTaskRunning("__beat__"))) return;
  const source = scriptText.value.trim();
  if (!source) return;
  // ③ 整片分镜改写：跳过 ② 节奏改写时先软提醒（允许继续，但把后果说清楚）。
  if (!scriptTarget.value && !beatText.value.trim() && !(await readText("beat.md")).trim()) {
    const ok = await confirmSkipStep(
      "跳过节奏改写，直接分镜改写？",
      "还没做第②步「节奏改写」：③ 会直接按 script.md 拆镜头，开场钩子、删拖沓、冲突反转与结尾悬念都没定稿，后面分镜表和分集制作都会沿用未经节奏优化的剧情。<br><br>建议先回第②步生成 beat.md。",
      "仍然直接改写", "先去节奏改写",
    );
    if (!ok) return;
  }
  // ③ / 分集原地改写：已有改写稿时先确认，避免误点一次就重跑覆盖。
  const rewriteLabel = scriptTarget.value ? "这一集的改写稿 rewrite.md" : "整片分镜稿 rewrite.md";
  if (!(await confirmRerun(rewriteLabel, rewriteText.value, `${scriptBase.value}rewrite.md`))) return;
  if (!textModels.value.length) await loadTextModels();
  const model = currentModel();
  if (!model) return ElMessage.warning("还没有可用的文本模型，请先在设置里配置");
  if (anyDirty.value) await saveScript();
  const target = scriptTarget.value;
  const base = scriptBase.value;
  const label = scriptLabel.value;
  const previousRewrite = rewriteText.value;
  await backupOutputs([`${base}rewrite.md`]);
  patchTask(target, { stage: "正在准备改写…", steps: 0 });
  rewriteText.value = "";
  rewriteDirty.value = false;
  try {
    const sessionFile = await ensureRewriteSession(target);
    // 判断依据与执行依据都取磁盘：手改过 beat.md 会立刻生效，不会读旧文件或凭记忆补写。
    const beatDisk = await readTextChecked("beat.md");
    if (!beatDisk.ok) return ElMessage.warning("无法读取 beat.md，为避免用错原文已停止；请检查项目目录后重试");
    const captured = await streamAgentRewrite(buildRewritePrompt(base, label, !base && !beatDisk.missing), sessionFile, model, target);
    const settled = await settleWritten(`${base}rewrite.md`, captured);
    if (scriptTarget.value !== target) {
      // 已经切到别的剧本：内容仍要落盘，回来时读文件即可，不能因为不看就丢掉。
      ElMessage.success(`${label} 已改写完成（当前在别的剧本）`);
      return;
    }
    rewriteText.value = settled;
    rewriteDirty.value = false;
    ElMessage.success("改写完成，已写入 rewrite.md");
  } catch (err) {
    if (scriptTarget.value === target && !rewriteText.value.trim()) rewriteText.value = previousRewrite;
    ElMessage.error(err instanceof Error ? err.message : "改写失败，请重试");
  } finally {
    dropTask(target);
  }
}

// 每批独立会话：不复用历史，避免对话上下文随批次数线性增长而爆窗。
async function ensureCreateSession(batchIndex = 0): Promise<string | undefined> {
  return ensureAgentSession(
    `markdirector.create.session:${directory.value.replace(/\\/g, "/").toLowerCase()}:b${batchIndex}`,
    `剧本创作 · 第${batchIndex + 1}批 · ${meta.value?.name || directoryDisplayName(directory.value)}`,
  );
}

function buildCreatePrompt(base: string, label: string, start: number, end: number, partPaths: string[], isFirst: boolean) {
  const adapt = createMode.value === "adapt";
  const requirement = createRequirement.value.trim() || (adapt ? DEFAULT_ADAPT_PROMPT : DEFAULT_CREATE_PROMPT);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lines = [
    adapt ? `【小说 → 剧本改编任务 · 第 ${start}–${end} 集 / 共 ${createEpisodes.value} 集】` : `【剧本创作任务 · 第 ${start}–${end} 集 / 共 ${createEpisodes.value} 集】`,
    `项目：${meta.value?.name || directoryDisplayName(directory.value)}`,
    `视觉风格：${meta.value ? projectStyleName(meta.value.style) : "未设置"}`,
    `正片画幅：${filmAspect.value}`,
    `目标：${label}`,
    `本批集号：第${pad(start)}集 – 第${pad(end)}集；单集约 ${createDuration.value} 秒`,
    "",
    "【上下文预算（必须遵守，防止后段爆窗与剧情漂移）】",
    `1. 本轮只写第 ${start}–${end} 集，严禁重写已完成的第 1–${Math.max(0, start - 1)} 集，严禁一次性生成全剧；`,
    `2. 开工先读取 ${base}创作状态.md（人物表 / 世界规则 / 伏笔清单 / 已写集摘要 / 下集接口），它是跨批唯一事实来源；`,
    ...(adapt ? [
      `3. 本批原文只读这些分片：${partPaths.join("、") || "novel/index.md"}；严禁读取 novel.md 全文或其它批次分片；`,
      "4. 不要凭记忆补写没读到的章节；没读到的原文标进「创作状态.md · 未覆盖原文」，留给后续批次；",
    ] : [
      "3. 原创模式没有原文分片；先按「创作状态.md」里已定的大纲、人物与伏笔续写本批集，不得另起炉灶；",
      "4. 若「创作状态.md」还不存在，本批先建它（全剧大纲 + 人物表 + 伏笔表 + 逐集钩子），再写本批集；",
    ]),
    "5. 单轮输出只含本批集正文，不复述前文、不重写已完成的集、不写修改说明；",
    `6. 写完本批先更新 ${base}创作状态.md（追加本批每集 2–3 句摘要、结尾钩子、下集接口、伏笔埋/收状态、人物状态变化），再写剧本；人物与设定一律沿用状态文件，不得另编；`,
    "",
    ...(adapt ? [
      "【任务层级】",
      "本任务只做「小说 → 剧本」的文体转换：小说是文学语言，剧本是视听语言。删拖沓、加钩子属于 ② 节奏改写，这一步不改节奏、不改结局。",
    ] : [
      "【一句话创意 / 题材】",
      createIdea.value.trim() || "（未提供，按项目名与视觉风格自行构思一个强冲突的短剧故事）",
    ]),
    "",
    "【改编 / 创作要求】",
    requirement,
    "",
    "【负面约束】",
    adapt ? ADAPT_NEGATIVE : "不要写成小说叙述体、不要大纲或梗概、不要解释与复述要求。",
    "",
    "【执行方式】",
    ...(adapt ? [
      "1. 把本批原文按场次拆分，每场写全：场号、场景（室内/室外、日/夜）、出场角色、场景描述（可视化）、动作、台词、旁白/内心独白（单独标注）、本场情绪、本场钩子；",
      "2. 心理活动三选一转化：表情/动作、旁白字幕、自言自语的台词；删掉大段内心独白与冗余环境描写；",
      "3. 保留核心冲突、名场面与人物关系，不新增原著没有的角色或支线；",
      "4. 台词口语化短句，一句不超过 20 字，括号标语气；",
    ] : [
      "1. 人物目标、阻力和结局沿用「创作状态.md」，不要另起设定；",
      "2. 只写剧本正文：场号、场景、时间（日/夜）、景别、角色动作表情、台词；",
    ]),
    `5. 本批每集用「## 第${pad(start)}集 标题」格式分节，集号两位数连续到 第${pad(end)}集，标题不超过 12 字；`,
    `6. 把本批 ${end - start + 1} 集正文写入 ${base}script.md：${isFirst ? "本批是第一批，覆盖写入" : "本批是续写，必须追加在已有内容之后，严禁覆盖前面已完成的集（文件工具不支持追加时，先读回全文、拼接本批、再整体写回）"}；`,
    `7. 写入后回读 ${base}script.md，核对第 1–${pad(end)} 集分节齐全、集号连续；缺集立即补齐再结束；`,
    "8. 不要改动 novel.md 与 novel/ 分片；不要创建画布、不要生成图片或视频；",
    `9. 完成后只回复一句「已写入第 ${start}–${end} 集」，正文一律在文件里。`,
  ];
  return lines.join("\n");
}

// ACT: 创作是整条链路的第一环。一次只跑一批，靠「创作状态.md」跨批保持一致性，避免长文本后段爆窗与剧情漂移。
async function runCreate() {
  if (creating.value || rewriting.value) return;
  const adapt = createMode.value === "adapt";
  if (!textModels.value.length) await loadTextModels();
  const model = currentModel();
  if (!model) return ElMessage.warning("还没有可用的文本模型，请先在设置里配置");
  if (anyDirty.value) await saveScript();
  const target = scriptTarget.value;
  const base = scriptBase.value;
  const label = scriptLabel.value;

  // 全部写完后再点就是重开：先确认，并把旧稿与状态锚点一起留档。
  if (createFinished.value) {
    const ok = await ElMessageBox.confirm(
      `${createEpisodes.value} 集已全部写完。重新开始会清空进度并覆盖 script.md / 创作状态.md（旧稿自动备份到 history/）。`,
      "重新开始创作", { type: "warning", confirmButtonText: "重新开始", cancelButtonText: "取消" },
    ).then(() => true, () => false);
    if (!ok) return;
    await backupOutputs([`${base}script.md`, `${base}创作状态.md`, "novel.md"]);
    createDoneEpisodes.value = 0;
    createBatchIndex.value = 0;
    saveCreateProgress();
  }
  const isFirst = createDoneEpisodes.value === 0;
  const start = createDoneEpisodes.value + 1;
  const end = Math.min(createEpisodes.value, start + Math.max(1, createBatchSize.value) - 1);
  const batchIndex = createBatchIndex.value;
  if (isFirst && scriptText.value.trim()) {
    const ok = await ElMessageBox.confirm(
      "左栏已有剧本，第一批会覆盖 script.md（旧稿自动备份到 history/）。", "覆盖剧本",
      { type: "warning", confirmButtonText: "覆盖并开始", cancelButtonText: "取消" },
    ).then(() => true, () => false);
    if (!ok) return;
  }
  if (adapt && isFirst && !novelText.value.trim()) return ElMessage.warning("请先粘贴小说 / 网文原文");

  creating.value = true;
  createStage.value = `第 ${batchIndex + 1}/${totalBatches.value} 批 · 第 ${start}–${end} 集`;
  patchTask("__create__", { stage: createStage.value, steps: 0 });
  try {
    const client = files();
    let partPaths: string[] = [];
    if (isFirst) await backupOutputs([`${base}script.md`, `${base}创作状态.md`, "novel.md"]);
    if (adapt) {
      // 本次粘贴的原文切片落盘，并追加进 novel.md（永不覆盖之前粘贴的章节）。
      const parts = splitNovel(novelText.value);
      await client.mkdir("novel").catch(() => {});
      for (let i = 0; i < parts.length; i += 1) {
        const path = `novel/part-${String(batchIndex * 100 + i + 1).padStart(3, "0")}.md`;
        await client.write(path, parts[i]);
        partPaths.push(path);
      }
      await appendText("novel.md", `<!-- 第 ${batchIndex + 1} 批粘贴，共 ${parts.length} 片 -->\n` + novelText.value);
      const indexLine = `- 第 ${batchIndex + 1} 批（第 ${start}–${end} 集）：${partPaths.join("、")}`;
      const idx = await readTextChecked("novel/index.md");
      if (!idx.ok || idx.missing) {
        await client.write("novel/index.md", [
          "# 小说原文分片索引", "",
          "- 完整原文：novel.md（各批次追加，永不覆盖）",
          `- 每片上限：${NOVEL_PART_CHARS} 字；Agent 每轮只读本批分片，不读 novel.md 全文。`,
          "", "## 批次", indexLine,
        ].join("\n"));
      } else {
        await appendText("novel/index.md", indexLine, "\n");
      }
      createStage.value = `第 ${batchIndex + 1}/${totalBatches.value} 批 · 改编第 ${start}–${end} 集`;
      patchTask("__create__", { stage: createStage.value });
    }

    // 每批独立会话，历史不累积；不流式回填（分批追加，落盘后统一重读）。
    const sessionFile = await ensureCreateSession(batchIndex);
    const captured = await streamAgentRewrite(
      buildCreatePrompt(base, label, start, end, partPaths, isFirst),
      sessionFile, model, "__create__", () => {},
    );

    // 完整性校验：磁盘优先，且 1..end 集号必须齐全；绝不把 Agent 的一句确认当剧本写盘。
    let disk = await readTextChecked(`${base}script.md`);
    const expected: number[] = [];
    for (let n = 1; n <= end; n += 1) expected.push(n);
    const collect = (t: string) => [...t.matchAll(/^\s*#{1,5}\s*(?:第\s*)?(\d{1,3})\s*[集话回]?\b/gm)].map(m => Number(m[1]));
    let missing = expected.filter(n => !collect(disk.ok ? disk.text : "").includes(n));
    // Agent 没写盘但把正文直接回在流里：把它当作本批正文追加，别把结果丢掉。
    if (missing.length && captured.length > 200 && expected.every(n => collect(captured).includes(n))) {
      await appendText(`${base}script.md`, captured.trim());
      disk = await readTextChecked(`${base}script.md`);
      missing = expected.filter(n => !collect(disk.ok ? disk.text : "").includes(n));
    }
    if (!disk.ok) throw new Error(`无法读取 ${base}script.md（${disk.error}），本批结果未确认，进度不推进`);
    if (!disk.text.trim() || missing.length) {
      throw new Error(`集号不完整（缺第 ${missing.join("、")} 集）：Agent 没把正文写进 script.md，进度未推进，请重试本批；不要继续下一批`);
    }
    if (scriptTarget.value === target) {
      scriptText.value = disk.text;
      scriptDirty.value = false;
    }
    createDoneEpisodes.value = end;
    createBatchIndex.value = batchIndex + 1;
    saveCreateProgress();
    createIdea.value = "";
    novelText.value = "";
    if (createFinished.value) {
      createOpen.value = false;
      ElMessage.success(`${createEpisodes.value} 集已全部写完（共 ${totalBatches.value} 批），下一步点流程第②步「节奏改写」`);
    } else {
      ElMessage.success(`第 ${start}–${end} 集已写入（${createDoneEpisodes.value}/${createEpisodes.value}），点「继续下一批」接着写；每批独立会话，上下文不会累积`);
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "本批创作失败，进度未推进，可重试");
  } finally {
    creating.value = false;
    createStage.value = "";
    dropTask("__create__");
  }
}

function openProjectInfo() {
  if (!directory.value) return;
  infoVisible.value = true;
}

function onInfoSaved(updated: ProjectMeta) {
  meta.value = updated;
}

async function askRewrite() {
  if (!scriptTarget.value) return;
  if (rewriting.value || storyboardRunning.value || creating.value || docRunning.value) return ElMessage.warning("还有任务在跑，等它结束再制作");
  const hasRewrite = !!rewriteText.value.trim();
  if (!hasRewrite && !scriptText.value.trim()) return;
  if (anyDirty.value) await saveScript();
  // 制作前检查：分镜表 / 节拍表 / 资产库是 A/B 段的硬依据；跳过 ② 只是跳步软提醒，仍可继续。
  const missing: string[] = [];
  const soft: string[] = [];
  const storyboardDisk = await readTextChecked(`${scriptBase.value}分镜表.md`);
  const beatsheetDisk = await readTextChecked(`${scriptBase.value}节拍表.md`);
  const assetsDisk = await readTextChecked("assets/资产库.md");
  const beatDisk = await readTextChecked("beat.md");
  if (!storyboardDisk.ok) missing.push(`分镜表读取失败（${storyboardDisk.error}），无法确认镜头是否已定稿`);
  else if (storyboardDisk.missing) missing.push("分镜表（点上方「生成分镜表 / 节拍表」，先验收镜头与时长）");
  if (!beatsheetDisk.ok) missing.push(`节拍表读取失败（${beatsheetDisk.error}），无法确认节奏是否已定稿`);
  else if (beatsheetDisk.missing) missing.push("节拍表（点上方「生成分镜表 / 节拍表」重新生成，制作指令会按它排时间轴）");
  if (!assetsDisk.ok) missing.push(`资产提示词库读取失败（${assetsDisk.error}）`);
  else if (assetsDisk.missing) missing.push("资产提示词库（回「整片剧本」点「生成资产提示词库」，A/B 段要引用它的 R 编号）");
  if (!beatDisk.ok) soft.push(`无法读取整片节奏稿 beat.md（${beatDisk.error}）`);
  else if (beatDisk.missing) soft.push("整片节奏稿 beat.md 还没生成（跳过了 ② 节奏改写）：镜头节奏、开场钩子与结尾悬念没定稿，制作会照未经节奏优化的剧情出图");
  if (missing.length || soft.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`<b>还缺这些硬依据：</b><br>${missing.map((item, index) => `${index + 1}. ${item}`).join("<br>")}<br><br>A 段分镜图提示词按分镜表的 L 编号出图，B 段视频提示词要引用资产库的 R 编号；缺了 Agent 会停下来或编号对不上。`);
    if (soft.length) parts.push(`<b>跳步提醒（可继续）：</b><br>${soft.map((item, index) => `${index + 1}. ${item}`).join("<br>")}`);
    const ok = await ElMessageBox.confirm(
      parts.join("<br><br>"),
      "分集制作前检查",
      { dangerouslyUseHTMLString: true, type: "warning", confirmButtonText: "仍然继续", cancelButtonText: "先去准备" },
    ).then(() => true, () => false);
    if (!ok) return;
  }
  if (!textModels.value.length) await loadTextModels();
  if (!produceSkills.value.length) await loadProduceSkills();
  const model = currentModel();
  const episode = episodes.value.find(item => item.id === scriptTarget.value);
  // ACT: 分集里的这个入口是「制作」，不是再改一遍：优先拿终稿 rewrite.md 去画布拆镜头、出图。
  store.pendingAgentMessage = {
    directory: directory.value,
    prompt: buildProducePrompt(scriptBase.value, scriptLabel.value, hasRewrite),
    model: model ? modelKey(model) : "",
    reasoningEffort: "",
    // 每集单独一条会话，名字直接用集号+标题，历史里一眼分清。
    sessionName: episode ? `${episode.id} ${episode.title} · 制作` : `${scriptLabel.value} · 制作`,
  };
  await router.push("/workspace");
}
</script>

<style lang="scss" scoped>
.rewriteModel {
  width: clamp(140px, 15vw, 190px);
  max-width: 100%;
}

.createRow {
  display: flex;
  gap: 16px;

  :deep(.el-form-item) { flex: 1; }
}

.adaptHint {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1.7;
}

.createBudget {
  margin: 2px 0 12px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: color-mix(in srgb, var(--el-fill-color-light) 45%, transparent);
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 1.7;

  strong { color: var(--el-text-color-primary); }
}

:global(.lateStageBox) { max-width: min(620px, 92vw); }

.episodeStages {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;

  .stageChip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 999px;
    color: var(--el-text-color-placeholder);
    font-size: 11px;
    line-height: 1.6;

    .stageDot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--el-border-color);
    }

    &.done {
      border-color: color-mix(in srgb, var(--md-gold) 45%, transparent);
      color: var(--md-gold);

      .stageDot { background: var(--md-gold); }
    }
  }
}

.projectPage {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}

.projectHeader {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 14px 20px;
  border-bottom: 1px solid var(--el-border-color-lighter);

  .backButton {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--ui-radius);
    background: transparent;
    color: var(--el-text-color-regular);
    cursor: pointer;

    &:hover { border-color: var(--el-border-color); color: var(--el-text-color-primary); }
  }

  .projectTitle {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;

    h1 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; font-weight: 600; }

    .styleTag {
      flex-shrink: 0;
      padding: 2px 7px;
      border: 1px solid color-mix(in srgb, var(--md-gold) 45%, transparent);
      border-radius: 5px;
      color: var(--md-gold);
      font-size: 11px;
    }
  }

  .projectCounters { color: var(--el-text-color-secondary); font-size: 12px; }
  .headerAction { margin-inline-start: auto; }
  .headerAction + .headerAction { margin-inline-start: 0; }
}

.projectTabs {
  display: flex;
  gap: 20px;
  flex-shrink: 0;
  padding: 0 20px;
  border-bottom: 1px solid var(--el-border-color-lighter);

  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 0 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--el-text-color-secondary);
    font: inherit;
    font-size: 13px;
    cursor: pointer;

    span { font-size: 11px; opacity: 0.6; }
    &.active { border-bottom-color: var(--md-gold); color: var(--el-text-color-primary); }
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
  }
}

.projectBody { flex: 1; min-height: 0; overflow: auto; }

.pageHint {
  margin: 0;
  padding: 16px 20px;
  color: var(--el-text-color-secondary);
  font-size: 13px;

  &.error { color: var(--el-color-danger); }
}

.episodePane { padding: 18px 20px 24px; }

.episodeGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 232px), 1fr));
  gap: 14px;
}

.episodeCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: calc(var(--ui-radius) * 2);
  background: var(--el-bg-color-overlay);

  .episodeTop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

  .episodeIndex {
    display: grid;
    place-items: center;
    min-width: 26px;
    height: 20px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--el-fill-color);
    color: var(--el-text-color-secondary);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .episodeStatus {
    font-size: 11px;
    color: var(--el-text-color-secondary);

    &[data-status="producing"] { color: var(--md-gold); }
    &[data-status="done"] { color: var(--el-color-success); }
  }

  .episodeTitle { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; }
  .episodeMeta { margin: 0; color: var(--el-text-color-secondary); font-size: 12px; }

  .episodeActions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; }
}

.episodeAdd {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 132px;
  border: 1px dashed var(--el-border-color);
  border-radius: calc(var(--ui-radius) * 2);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;

  &:hover:not(:disabled) { border-color: color-mix(in srgb, var(--md-gold) 55%, transparent); color: var(--md-gold); }
  &:disabled { cursor: wait; opacity: 0.6; }
}

.assetPane { height: 100%; }

.scriptPane {
  display: flex;
  height: 100%;
  min-height: 0;
}

.scriptAside {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
  width: 190px;
  padding: 12px;
  overflow: auto;
  border-inline-end: 1px solid var(--el-border-color-lighter);

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--ui-radius);
    background: transparent;
    color: var(--el-text-color-secondary);
    font: inherit;
    font-size: 13px;
    text-align: start;
    cursor: pointer;

    .asideIndex { font-size: 11px; opacity: 0.6; font-variant-numeric: tabular-nums; }
    // 并行改写时，没打开的那一集也能看出正在跑。
    .asideRunning {
      flex-shrink: 0;
      width: 6px;
      height: 6px;
      margin-inline-start: auto;
      border-radius: 50%;
      background: var(--md-gold);
      animation: asidePulse 1.4s ease-in-out infinite;
    }
    &:hover { background: var(--el-fill-color-light); }
    &.active { background: var(--el-fill-color); color: var(--el-text-color-primary); }
  }
}

.docViewHead {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;

  .el-select { width: 230px; }
  span { font-size: 11px; color: var(--el-text-color-placeholder); }
}

.docViewEmpty {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.scriptEditor {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;

  .deliverableBar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    padding: 8px 16px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    background: color-mix(in srgb, var(--el-fill-color-light) 35%, transparent);

    .el-button { flex-shrink: 0; margin-inline-start: 0; }
    .deliverableLabel {
      flex-shrink: 0;
      padding: 3px 8px;
      border: 1px solid var(--el-border-color);
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      color: var(--el-text-color-secondary);
      cursor: help;
    }
    .docTopicSelect { width: 216px; flex-shrink: 0; }
    .deliverableHint { flex: 1 1 220px; min-width: 0; margin-inline-start: auto; font-size: 11px; line-height: 1.5; color: var(--el-text-color-placeholder); }
  }

  .scriptFlow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    margin: 0;
    padding: 10px 16px 0;
    list-style: none;

    li { display: flex; align-items: center; gap: 6px; }

    .flowGroupLabel {
      flex-shrink: 0;
      margin-inline-end: 2px;
      padding: 3px 8px;
      border: 1px solid var(--el-border-color);
      border-radius: 6px;
      font-size: 11px;
      color: var(--el-text-color-secondary);
      cursor: help;
    }

    button {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 5px 9px;
      border: 1px solid var(--el-border-color-lighter);
      border-radius: 9px;
      background: var(--el-bg-color);
      color: var(--el-text-color-regular);
      cursor: pointer;
      text-align: start;
      transition: border-color 150ms ease, background-color 150ms ease;

      &:hover:not(:disabled) { border-color: var(--el-color-primary-light-5); }
      &:disabled { cursor: default; opacity: 0.55; }
    }

    .flowIndex {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--el-fill-color);
      color: var(--el-text-color-secondary);
      font-size: 11px;
      line-height: 1;
    }

    .flowText {
      display: flex;
      flex-direction: column;
      line-height: 1.3;

      strong { font-size: 12px; font-weight: 600; }
      small { color: var(--el-text-color-placeholder); font-size: 10px; }
    }

    .flowArrow { flex-shrink: 0; color: var(--el-text-color-placeholder); }

    li.soft button { border-style: dashed; background: transparent; }
    li.soft .flowIndex { border: 1px dashed var(--el-border-color); background: transparent; }

    li.done .flowIndex { background: var(--el-color-success-light-8); color: var(--el-color-success); }
    li.current button { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
    li.current .flowIndex { background: var(--el-color-primary); color: var(--el-color-white); }
  }

  .scriptEmpty {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-shrink: 0;
    margin: 10px 16px 0;
    padding: 12px 14px;
    border: 1px dashed var(--el-border-color);
    border-radius: var(--ui-radius);
    background: color-mix(in srgb, var(--el-fill-color-light) 50%, transparent);

    strong { font-size: 12px; }
    p { margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.6; }

    .el-button { flex-shrink: 0; margin-inline-start: auto; }
  }

  .scriptToolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    flex-shrink: 0;
    padding: 10px 16px;
    border-bottom: 1px solid var(--el-border-color-lighter);

    // 左侧信息整体占一块，宽度不够时按钮组换到下一行，绝不把集名压成竖排。
    .scriptToolbarMeta {
      display: flex;
      flex: 1 1 240px;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .toolbarTitle {
      max-width: 100%;
      overflow: hidden;
      font-size: 13px;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dirtyHint { flex-shrink: 0; color: var(--md-gold); font-size: 11px; }
    .toolbarGroup {
      flex-shrink: 0;
      padding: 3px 8px;
      border: 1px solid var(--el-border-color);
      border-radius: 6px;
      font-size: 11px;
      color: var(--el-text-color-secondary);
      cursor: help;
    }

    .toolbarHint { flex-shrink: 0; font-size: 11px; color: var(--el-text-color-placeholder); }

    .scriptToolbarActions {
      display: flex;
      flex: 1 1 auto;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      min-width: 0;
      margin-inline-start: auto;

      > * { flex-shrink: 0; }
      .el-button { margin-inline-start: 0; }
    }
  }

  .rewriteProgress {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    padding: 6px 16px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    background: color-mix(in srgb, var(--el-fill-color-light) 55%, transparent);
    color: var(--el-text-color-regular);
    font-size: 12px;

    .pulse {
      flex-shrink: 0;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--md-gold);
      animation: rewritePulse 1.1s ease-in-out infinite;
    }

    .progressText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .progressCount { margin-inline-start: auto; color: var(--el-text-color-placeholder); font-size: 11px; }
  }

  .scriptToolbarActions .promptCustom {
    border-color: color-mix(in srgb, var(--md-gold) 55%, transparent);
    color: var(--md-gold);
  }

  .scriptColumns { display: flex; flex: 1; min-height: 0; }

  .scriptColumn {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;

    & + .scriptColumn { border-inline-start: 1px solid var(--el-border-color-lighter); }

    .columnLabel { padding: 8px 14px; color: var(--el-text-color-secondary); font-size: 11px; }

    textarea {
      flex: 1;
      width: 100%;
      min-height: 0;
      padding: 0 14px 14px;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--el-text-color-primary);
      font-family: var(--md-font-sans);
      font-size: 13px;
      line-height: 1.9;
      resize: none;
    }
  }
}

// 窄窗口：先收窄侧栏、把提示文字整行放下；再窄就把侧栏改成横向条，按钮组靠左换行。
@media (max-width: 1180px) {
  .scriptAside { width: 150px; padding: 8px; }
  .scriptEditor .deliverableBar .deliverableHint { flex-basis: 100%; margin-inline-start: 0; }
}

@media (max-width: 860px) {
  .scriptPane { flex-direction: column; }
  .scriptAside {
    width: 100%;
    max-height: 132px;
    flex-direction: row;
    flex-wrap: wrap;
    border-inline-end: 0;
    border-bottom: 1px solid var(--el-border-color-lighter);

    button { flex: 0 0 auto; }
  }
  .scriptEditor .scriptToolbar .scriptToolbarActions { justify-content: flex-start; }
}

@keyframes rewritePulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

.splitHint {
  margin: 0 0 10px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.splitList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 52vh;
  overflow: auto;
}

.splitRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;

  &.exists { opacity: 0.55; }

  :deep(.el-input) { flex: 1; min-width: 0; }

  .splitId { flex-shrink: 0; width: 26px; color: var(--md-gold); font-size: 12px; font-weight: 500; }
  .splitMeta { flex-shrink: 0; width: 54px; text-align: end; color: var(--el-text-color-placeholder); font-size: 11px; }
}

:global(.el-popover.rewritePromptPopper) {
  .promptPanel { display: flex; flex-direction: column; gap: 8px; }
  .promptModeSwitch { display: flex; gap: 6px; }
  .promptModeSwitch .el-button { margin: 0; flex: 1; }

  .promptPanelHead {
    display: flex;
    align-items: center;
    gap: 8px;

    strong { font-size: 13px; font-weight: 500; }
    span { color: var(--el-text-color-placeholder); font-size: 11px; }
    .el-button { margin-inline-start: auto; }
  }

  .el-textarea__inner { font-size: 12px; line-height: 1.7; }

  .promptPanelFoot { margin: 0; color: var(--el-text-color-placeholder); font-size: 11px; }

  .promptPanelSkill {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--el-border-color-lighter);
  }

  .skillOptionName { margin-inline-end: 8px; }
  .skillOptionId { color: var(--el-text-color-placeholder); font-size: 11px; }
}

@keyframes asidePulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
</style>
