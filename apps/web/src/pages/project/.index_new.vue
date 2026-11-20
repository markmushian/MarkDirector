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
              <el-button size="small" type="primary" :loading="saving" :disabled="!anyDirty" title="把三栏手改的内容写回 script.md / beat.md / rewrite.md" @click="saveScript">保存</el-button>
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
              <textarea v-model="scriptText" spellcheck="false" :placeholder="scriptTarget ? '本集结构化剧本（由按集拆分生成）；不要直接贴小说原文' : '结构化剧本 script.md：由 ① 创作 / 改编生成。小说原文存 novel.md，不要直接把小说叙述体贴进来，否则 ②③ 会当成剧本处理'" @input="scriptDirty = true" />
            </label>
            <label v-if="!scriptTarget" class="scriptColumn beatColumn">
              <span class="columnLabel">节奏稿 beat.md · ② 节奏改写</span>
              <textarea v-model="beatText" spellcheck="false" placeholder="节奏改写结果写在这里：删拖沓、开场钩子、冲突反转、结尾悬念；可以直接手改…" @input="beatDirty = true" />
            </label>
            <label class="scriptColumn">
              <span class="columnLabel">改写 rewrite.md{{ scriptTarget ? " · 分集精修" : " · ③ 分镜改写" }}</span>
              <textarea v-model="rewriteText" spellcheck="false" placeholder="助手改写后的分镜剧本会写在这里，也可以手改…" @input="rewriteDirty = true" />
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
          <p class="adaptHint">{{ createMode === "adapt" ? "小说是文学语言、剧本是视听语言，不能直接拿小说出分镜。原文会原样存为 novel.md，AI 按场次结构改编成 script.md，之后照常走 ② 节奏改写 → ③ 分镜改写。" : "从零写一部结构化剧本；现成小说请切到「改编」，不要直接把小说贴进剧本栏。" }}</p>
        </el-form-item>
        <el-form-item v-if="createMode === 'original'" label="一句话创意 / 题材">
          <el-input v-model="createIdea" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" resize="none" :disabled="creating" placeholder="例如：外卖员救下集团千金，被误认成豪门私生子，一路打脸逆袭…" />
        </el-form-item>
        <el-form-item v-else label="小说 / 网文原文（粘贴全文或本章）">
          <el-input v-model="novelText" type="textarea" :autosize="{ minRows: 8, maxRows: 18 }" resize="none" :disabled="creating" placeholder="把番茄小说 / 原创小说的章节原文粘贴进来…会原样存为 novel.md，再改编成结构化剧本。原文很长时可分章多次改编，后一次会接在前一次的 script.md 之后。" />
        </el-form-item>
        <div class="createRow">
          <el-form-item label="集数">
            <el-input-number v-model="createEpisodes" :min="1" :max="200" :disabled="creating" size="small" controlsPosition="right" />
          </el-form-item>
          <el-form-item label="单集时长（秒）">
            <el-input-number v-model="createDuration" :min="10" :max="900" :step="10" :disabled="creating" size="small" controlsPosition="right" />
          </el-form-item>
        </div>
        <el-form-item :label="createMode === 'adapt' ? '改编要求（可留空）' : '创作要求（可留空）'">
          <el-input v-model="createRequirement" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" resize="none" :disabled="creating" :placeholder="createMode === 'adapt' ? '留空用默认改编要求。例如：保留原著名场面，砍掉全部心理独白，每集一个反转…' : '留空用默认要求。例如：竖屏女频复仇爽剧，每集一个反转，开头 3 秒抓人，结尾留钩子…'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="creating" @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="(!textModels.length && modelsLoading) || (createMode === 'adapt' && !novelText.trim())" @click="runCreate">{{ createMode === 'adapt' ? (scriptText.trim() ? '覆盖并重新改编' : '开始改编') : (scriptText.trim() ? '覆盖并重新创作' : '开始创作') }}</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="docViewOpen" title="制作文档 · 查看与复制" width="min(880px, 94vw)" alignCenter appendToBody>
      <div class="docViewHead">
        <el-select v-model="docViewKey" size="small" aria-label="选择制作文档">
          <el-option v-for="item in docViewItems" :key="item.key" :label="item.label" :value="item.key" />
        </el-select>
        <el-button size="small" type="primary" :disabled="!docViewText.trim()" @click="copyDocView">复制全文</el-button>
        <span>提示词可直接粘贴到出图 / 视频工具</span>
      </div>
      <el-input v-model="docViewText" type="textarea" :autosize="{ minRows: 16, maxRows: 26 }" readonly resize="none" spellcheck="false" aria-label="制作文档内容" />
      <p v-if="!docViewText.trim()" class="docViewEmpty">这个文件还没生成。整片视角用「生成企划案 / 生成资产提示词库」；分集视角用「生成分镜表 / 节拍表」，或点「交给工作区制作」生成导演手册与发布包。</p>
    </el-dialog>
    <projectInfoDialog v-model="infoVisible" :directory="directory" :meta="meta" @saved="onInfoSaved" />
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, nextTick, onMounted, ref, watch } from "vue";
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
  return items;
});
watch(docTopic, value => {
  try { localStorage.setItem("markdirector.deliverable.topic", value); } catch { /* 隐私模式忽略 */ }
});
watch(docViewKey, () => { if (docViewOpen.value) void loadDocView(); });

function topicPrefix() { return docTopic.value ? `/skill:${docTopic.value} ` : ""; }

async function ensureDocSession(kind: string): Promise<string | undefined> {
  const key = `markdirector.deliverable.session:${kind}:${directory.value.replace(/\\/g, "/").toLowerCase()}`;
  const saved = localStorage.getItem(key) ?? "";
  if (saved) {
    try {
      const { data } = await axios.get<{ code: number }>("/api/agent/get", {
        params: { directory: directory.value, sessionFile: saved }, headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" },
      });
      if (data.code === 200) return saved;
    } catch { /* 会话已不存在，下面重建 */ }
  }
  const { data } = await axios.post<{ code: number; data?: { file?: string } }>("/api/agent/create", { directory: directory.value }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } });
  const file = data.data?.file;
  if (!file) return undefined;
  localStorage.setItem(key, file);
  const name = `${kind === "plan" ? "企划案" : "资产提示词库"} · ${meta.value?.name || directoryDisplayName(directory.value)}`;
  void axios.patch("/api/agent/rename", { directory: directory.value, sessionFile: file, name }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } }).catch(() => {});
  return file;
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
  if (scriptDirty.value || rewriteDirty.value) await saveScript();
  const path = kind === "plan" ? "企划案.md" : "assets/资产库.md";
  const label = kind === "plan" ? "企划案" : "资产提示词库";
  docRunning.value = kind;
  try {
    const sessionFile = await ensureDocSession(kind);
    const captured = await streamAgentRewrite(
      kind === "plan" ? buildPlanPrompt() : buildAssetPrompt(),
      sessionFile, model, `__doc_${kind}__`, () => {},
    );
    const written = await readText(path);
    if (!written.trim()) {
      if (!captured.trim()) throw new Error("Agent 没有返回内容，请检查模型或 CLI 是否可用");
      await files().write(path, captured);
    }
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
  await loadDocView();
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
  for (const episode of meta.value.episodes) {
    if (!episode.dir) { next[episode.id] = {}; continue; }
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
  try {
    let raw: unknown = null;
    try { raw = await files().readJson(PROJECT_META_FILE); } catch { raw = null; }
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
  await load();
  // 首次进入就把整片三份文件读进来，否则 script.md / beat.md / rewrite.md 要手点一次「整片剧本」才出现。
  await selectScript("");
  await loadEpisodeStages();
  void loadTextModels();
  // 提前读技能目录，第一次点「交给工作区制作」就能带上正确的 /skill: 前缀。
  void loadProduceSkills();
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
const splitSourceLabel = computed(() => {
  if (rewriteText.value.trim()) return "改写稿 rewrite.md";
  if (!scriptTarget.value && beatText.value.trim()) return "节奏稿 beat.md";
  return "原文 script.md";
});

async function openSplit() {
  if (splitLoading.value) return;
  splitLoading.value = true;
  try {
    const source = rewriteText.value.trim() ? rewriteText.value : (beatText.value.trim() && !scriptTarget.value ? beatText.value : scriptText.value);
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
    for (const item of targets) {
      const dir = `episodes/${item.id}-${safeFolder(item.title)}`;
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
  if (scriptTarget.value === episode.id) selectScript("");
  await saveMeta().catch(() => {});
}

async function readText(path: string) {
  try { return await files().readText(path); } catch { return ""; }
}

async function selectScript(id: string) {
  scriptTarget.value = id;
  const base = id ? `${episodes.value.find(item => item.id === id)?.dir ?? ""}/` : "";
  scriptText.value = await readText(`${base}script.md`);
  // beat.md 是整片级文件；分集剧本已经由拆分从节奏稿生成，不需要再挂一份。
  beatText.value = id ? "" : await readText("beat.md");
  rewriteText.value = await readText(`${base}rewrite.md`);
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

async function saveScript() {
  if (!directory.value) return;
  saving.value = true;
  try {
    if (scriptDirty.value) await files().write(`${scriptBase.value}script.md`, scriptText.value);
    if (beatDirty.value && !scriptTarget.value) await files().write("beat.md", beatText.value);
    if (rewriteDirty.value) await files().write(`${scriptBase.value}rewrite.md`, rewriteText.value);
    scriptDirty.value = false;
    beatDirty.value = false;
    rewriteDirty.value = false;
    ElMessage.success("剧本已保存");
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

function buildRewritePrompt(base = scriptBase.value, label = scriptLabel.value) {
  const requirement = rewritePrompt.value.trim() || defaultPrompt.value;
  // 整片有节奏稿就以它为准，否则退回原文；分集目录里没有 beat.md，仍读 script.md。
  const source = !base && beatText.value.trim() ? "beat.md" : "script.md";
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
  return `markdirector.beat.session:${directory.value.toLowerCase()}`;
}

// 节奏改写单独一条会话，不污染创作 / 改写 / 制作的历史。
async function ensureBeatSession(): Promise<string | undefined> {
  const saved = localStorage.getItem(beatSessionKey()) ?? "";
  if (saved) {
    try {
      const { data } = await axios.get<{ code: number }>("/api/agent/get", {
        params: { directory: directory.value, sessionFile: saved }, headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" },
      });
      if (data.code === 200) return saved;
    } catch { /* 会话已不存在，下面重建 */ }
  }
  const { data } = await axios.post<{ code: number; data?: { file?: string } }>("/api/agent/create", { directory: directory.value }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } });
  const file = data.data?.file;
  if (!file) return undefined;
  localStorage.setItem(beatSessionKey(), file);
  const name = `节奏改写 · ${meta.value?.name || directoryDisplayName(directory.value)}`;
  void axios.patch("/api/agent/rename", { directory: directory.value, sessionFile: file, name }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } }).catch(() => {});
  return file;
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
  if (scriptDirty.value || beatDirty.value || rewriteDirty.value) await saveScript();
  const previous = beatText.value;
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
    const written = await readText("beat.md");
    if (written.trim()) beatText.value = written;
    else if (captured) {
      beatText.value = captured;
      await files().write("beat.md", captured);
    } else throw new Error("Agent 没有返回内容，请检查模型或 CLI 是否可用");
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
  const key = storyboardSessionKey(target);
  const saved = localStorage.getItem(key) ?? "";
  if (saved) {
    try {
      const { data } = await axios.get<{ code: number }>("/api/agent/get", {
        params: { directory: directory.value, sessionFile: saved }, headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" },
      });
      if (data.code === 200) return saved;
    } catch { /* 会话已不存在，下面重建 */ }
  }
  const { data } = await axios.post<{ code: number; data?: { file?: string } }>("/api/agent/create", { directory: directory.value }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } });
  const file = data.data?.file;
  if (!file) return undefined;
  localStorage.setItem(key, file);
  const name = `分镜表 · ${scriptLabel.value}`;
  void axios.patch("/api/agent/rename", { directory: directory.value, sessionFile: file, name }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } }).catch(() => {});
  return file;
}

async function runStoryboard() {
  if (!scriptTarget.value || storyboardRunning.value || rewriting.value) return;
  const hasRewrite = !!rewriteText.value.trim();
  if (!hasRewrite && !scriptText.value.trim()) return ElMessage.warning("这一集还没有剧本");
  if (scriptDirty.value || rewriteDirty.value) await saveScript();
  const base = scriptBase.value;
  // 与 ②③ 共用一套「已有产出先确认」，避免误点一次就覆盖定稿的分镜表。
  if (!(await confirmRerun("这一集的分镜表 / 节拍表", "", `${base}分镜表.md`))) return;
  if (!textModels.value.length) await loadTextModels();
  const model = currentModel();
  if (!model) return ElMessage.warning("还没有可用的文本模型，请先在设置里配置");
  storyboardRunning.value = true;
  patchTask("__storyboard__", { stage: "正在拆分镜头与节拍…", steps: 0 });
  try {
    const sessionFile = await ensureStoryboardSession(scriptTarget.value);
    await streamAgentRewrite(buildStoryboardPrompt(base, scriptLabel.value, hasRewrite), sessionFile, model, "__storyboard__");
    const written = await readText(`${base}分镜表.md`);
    if (!written.trim()) throw new Error("分镜表没有写入，请检查模型或 CLI 是否可用后重试");
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
  const saved = localStorage.getItem(rewriteSessionKey(target)) ?? "";
  if (saved) {
    try {
      const { data } = await axios.get<{ code: number }>("/api/agent/get", {
        params: { directory: directory.value, sessionFile: saved }, headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" },
      });
      if (data.code === 200) return saved;
    } catch { /* 会话已不存在，下面重建 */ }
  }
  const { data } = await axios.post<{ code: number; data?: { file?: string } }>("/api/agent/create", { directory: directory.value }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } });
  const file = data.data?.file;
  if (!file) return undefined;
  localStorage.setItem(rewriteSessionKey(target), file);
  const episode = episodes.value.find(item => item.id === target);
  const name = target ? `剧本改写 · ${episode ? `${episode.id} ${episode.title}` : target}` : "剧本改写 · 整片";
  void axios.patch("/api/agent/rename", { directory: directory.value, sessionFile: file, name }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } }).catch(() => {});
  return file;
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
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: { type?: string; blockId?: string; delta?: string; content?: string; message?: string; tool?: { id?: string; name?: string; status?: string } };
        try { event = JSON.parse(line); } catch { continue; }
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
      }
    }
  } finally { reader.releaseLock(); }
  if (failure) throw new Error(failure);
  return [...blocks.values()].join("\n\n").trim();
}

// ACT: 原地改写统一走 /api/agent，和对话 Agent 同一套模型、技能与内置提示词，不再直连 /api/ai/generate。
async function runRewrite() {
  // 只阻止同一集重复提交；别的分集或整片正在改写时仍可同时开始。
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
  if (scriptDirty.value) await saveScript();
  const target = scriptTarget.value;
  const base = scriptBase.value;
  const label = scriptLabel.value;
  const previousRewrite = rewriteText.value;
  patchTask(target, { stage: "正在准备改写…", steps: 0 });
  rewriteText.value = "";
  rewriteDirty.value = false;
  try {
    const sessionFile = await ensureRewriteSession(target);
    const captured = await streamAgentRewrite(buildRewritePrompt(base, label), sessionFile, model, target);
    // Agent 可能直接用文件工具写盘，优先以磁盘内容为准。
    const written = await readText(`${base}rewrite.md`);
    if (scriptTarget.value !== target) {
      // 已经切到别的剧本：内容仍要落盘，回来时读文件即可，不能因为不看就丢掉。
      if (!written.trim() && captured) await files().write(`${base}rewrite.md`, captured);
      ElMessage.success(`${label} 已改写完成（当前在别的剧本）`);
      return;
    }
    if (written.trim()) rewriteText.value = written;
    else if (captured) {
      rewriteText.value = captured;
      await files().write(`${base}rewrite.md`, captured);
    } else throw new Error("Agent 没有返回内容，请检查模型或 CLI 是否可用");
    rewriteDirty.value = false;
    ElMessage.success("改写完成，已写入 rewrite.md");
  } catch (err) {
    if (scriptTarget.value === target && !rewriteText.value.trim()) rewriteText.value = previousRewrite;
    ElMessage.error(err instanceof Error ? err.message : "改写失败，请重试");
  } finally {
    dropTask(target);
  }
}

// 创作单独一条会话，避免和整片改写的历史混在一起。
async function ensureCreateSession(): Promise<string | undefined> {
  const key = `markdirector.create.session:${directory.value.replace(/\\/g, "/").toLowerCase()}`;
  const saved = localStorage.getItem(key) ?? "";
  if (saved) {
    try {
      const { data } = await axios.get<{ code: number }>("/api/agent/get", {
        params: { directory: directory.value, sessionFile: saved }, headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" },
      });
      if (data.code === 200) return saved;
    } catch { /* 会话已不存在，下面重建 */ }
  }
  const { data } = await axios.post<{ code: number; data?: { file?: string } }>("/api/agent/create", { directory: directory.value }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } });
  const file = data.data?.file;
  if (!file) return undefined;
  localStorage.setItem(key, file);
  const name = `剧本创作 · ${meta.value?.name || directoryDisplayName(directory.value)}`;
  void axios.patch("/api/agent/rename", { directory: directory.value, sessionFile: file, name }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } }).catch(() => {});
  return file;
}

function buildCreatePrompt(base: string, label: string) {
  const adapt = createMode.value === "adapt";
  const requirement = createRequirement.value.trim() || (adapt ? DEFAULT_ADAPT_PROMPT : DEFAULT_CREATE_PROMPT);
  const lines = [
    adapt ? "【小说 → 剧本改编任务】" : "【剧本创作任务】",
    `项目：${meta.value?.name || directoryDisplayName(directory.value)}`,
    `视觉风格：${meta.value ? projectStyleName(meta.value.style) : "未设置"}`,
    `正片画幅：${filmAspect.value}`,
    `目标：${label}`,
    `规模：共 ${createEpisodes.value} 集，每集约 ${createDuration.value} 秒`,
    "",
    ...(adapt ? [
      "【素材来源】",
      `先读取 ${base}novel.md（小说原文，文学叙述体）作为唯一素材，原文很长时按章节顺序完整改编，不要省略后半段；`,
      "",
      "【任务层级】",
      "本任务只做「小说 → 剧本」的文体转换：小说是文学语言（叙述、描写、心理活动），剧本是视听语言（场景 + 动作 + 台词 + 旁白）。",
      "AI 无法把大段小说描写直接变成稳定镜头，必须先结构化成场次。删拖沓、加钩子属于下一环节 ② 节奏改写（beat.md），这一步不改节奏、不改结局。",
      "",
      "【改编要求】",
      requirement,
      "",
      "【负面约束】",
      ADAPT_NEGATIVE,
    ] : [
      "【一句话创意 / 题材】",
      createIdea.value.trim() || "（未提供，按项目名与视觉风格自行构思一个强冲突的短剧故事）",
      "",
      "【创作要求】",
      requirement,
    ]),
    "",
    "【执行方式】",
    ...(adapt ? [
      "1. 把小说按场次拆分，每场写全：场号、场景（室内/室外、日/夜）、出场角色、场景描述（可视化，不写抽象情绪）、动作、台词、旁白/内心独白（单独标注）、本场情绪、本场钩子；",
      "2. 心理活动三选一转化：变成表情/动作、变成旁白字幕、变成自言自语的台词；删掉大段内心独白与冗余环境/服饰描写；",
      "3. 保留核心冲突、名场面与人物关系，不新增原著没有的角色或支线；无法可视化的抽象概念改成可视动作或删掉；",
      "4. 场景描述提炼成可用于后续画面生成的关键词；台词口语化短句，括号标语气；",
      "5. 不要写成小说叙述体、不要保留大段文学描写、不要抽象情绪词堆砌、不要长段台词；",
    ] : [
      "1. 先想清楚人物目标、阻力和结局，再写完整剧本，不要写成大纲或梗概；",
      "2. 只写剧本正文：场号、场景、时间（日/夜）、景别、角色动作表情、台词；",
    ]),
    `${adapt ? "6" : "3"}. 多集时按「## 第01集 标题」分节，集号两位数连续，标题不超过 12 字；`,
    `${adapt ? "7" : "4"}. 把完整剧本写入 ${base}script.md（覆盖写入，只写正文，不要解释、不要复述要求）；`,
    ...(adapt ? [`8. 不要改动 ${base}novel.md；`] : []),
    `${adapt ? "9" : "5"}. 本阶段只产出剧本文件，不要创建画布、不要生成图片或视频；`,
    `${adapt ? "10" : "6"}. 完成后只回复一句「已写入 script.md」。`,
  ];
  return lines.join("\n");
}

// ACT: 创作是整条链路的第一环，产出 script.md，后续改写/拆集都以它为原文。
async function runCreate() {
  if (creating.value || rewriting.value) return;
  const adapt = createMode.value === "adapt";
  if (adapt && !novelText.value.trim()) return ElMessage.warning("请先粘贴小说 / 网文原文");
  if (!textModels.value.length) await loadTextModels();
  const model = currentModel();
  if (!model) return ElMessage.warning("还没有可用的文本模型，请先在设置里配置");
  if (scriptDirty.value) await saveScript();
  const target = scriptTarget.value;
  const base = scriptBase.value;
  const label = scriptLabel.value;
  const previous = scriptText.value;
  if (previous.trim()) {
    const ok = await ElMessageBox.confirm(adapt ? "左栏已经有剧本内容，本次改编会覆盖 script.md（novel.md 也会覆盖为这次粘贴的原文）。" : "左栏已经有剧本内容，本次创作会覆盖 script.md。", "覆盖剧本", {
      type: "warning", confirmButtonText: adapt ? "覆盖改编" : "覆盖创作", cancelButtonText: "取消",
    }).then(() => true, () => false);
    if (!ok) return;
  }
  creating.value = true;
  createStage.value = adapt ? "正在保存小说原文…" : "正在构思故事…";
  patchTask("__create__", { stage: adapt ? "正在保存小说原文…" : "正在构思故事…", steps: 0 });
  try {
    if (adapt) {
      await files().write("novel.md", novelText.value);
      createStage.value = "正在改编小说为结构化剧本…";
      patchTask("__create__", { stage: "正在改编小说为结构化剧本…" });
    }
    const sessionFile = await ensureCreateSession();
    const captured = await streamAgentRewrite(buildCreatePrompt(base, label), sessionFile, model, "__create__", text => {
      if (scriptTarget.value !== target) return;
      scriptText.value = text;
      scriptDirty.value = true;
    });
    // Agent 可能自己写盘，优先以磁盘内容为准。
    const written = await readText(`${base}script.md`);
    if (scriptTarget.value === target) {
      if (written.trim()) {
        scriptText.value = written;
        scriptDirty.value = false;
      } else if (captured) {
        scriptText.value = captured;
        await files().write(`${base}script.md`, captured);
        scriptDirty.value = false;
      } else throw new Error("Agent 没有返回内容，请检查模型或 CLI 是否可用");
    } else if (!written.trim() && captured) {
      await files().write(`${base}script.md`, captured);
    }
    createOpen.value = false;
    createIdea.value = "";
    novelText.value = "";
    ElMessage.success(adapt ? "小说原文已存 novel.md，改编剧本已写入 script.md，下一步点流程第②步「节奏改写」" : "剧本已写入 script.md，下一步点流程第②步「节奏改写」");
  } catch (err) {
    if (scriptTarget.value === target && !scriptText.value.trim()) scriptText.value = previous;
    ElMessage.error(err instanceof Error ? err.message : "创作失败，请重试");
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
  const hasRewrite = !!rewriteText.value.trim();
  if (!hasRewrite && !scriptText.value.trim()) return;
  if (scriptDirty.value || rewriteDirty.value) await saveScript();
  // 制作前检查：分镜表与资产库是 A/B 段的硬依据；跳过 ② 节奏改写只是跳步软提醒，仍可继续。
  const missing: string[] = [];
  const soft: string[] = [];
  if (!(await readText(`${scriptBase.value}分镜表.md`)).trim()) missing.push("分镜表 / 节拍表（点上方「生成分镜表 / 节拍表」，先验收镜头与时长）");
  if (!(await readText("assets/资产库.md")).trim()) missing.push("资产提示词库（回「整片剧本」点「生成资产提示词库」，A/B 段要引用它的 R 编号）");
  if (!(await readText("beat.md")).trim()) soft.push("整片节奏稿 beat.md 还没生成（跳过了 ② 节奏改写）：镜头节奏、开场钩子与结尾悬念没定稿，制作会照未经节奏优化的剧情出图");
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
