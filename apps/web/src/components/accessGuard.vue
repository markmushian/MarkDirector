<template>
  <el-dialog v-model="open" title="访问验证" width="min(380px, 92vw)" appendToBody :closeOnClickModal="false" :showClose="!locked">
    <p class="guardHint">{{ locked ? "本工作台处于受保护状态，输入访问码以继续。" : "输入访问码以开启演示保护；开启后重启应用依然生效。" }}</p>
    <el-input v-model="code" type="password" placeholder="访问码" showPassword @keyup.enter="submit" />
    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" :loading="busy" @click="submit">{{ locked ? "解锁" : "开启保护" }}</el-button>
    </template>
  </el-dialog>
  <teleport to="body">
    <div v-if="locked" class="accessShield">
      <div class="shieldCard">
        <img :src="logoUrl" alt="" class="shieldLogo" />
        <h2 class="shieldTitle">访问验证</h2>
        <p class="shieldHint">本工作台处于受保护状态，输入访问码以继续使用。</p>
        <el-input v-model="code" type="password" placeholder="访问码" class="shieldInput" @keyup.enter="submit" />
        <el-button type="primary" class="shieldButton" :loading="busy" @click="submit">解锁</el-button>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import logoUrl from "@markdirector/assets/logo.svg";

// 演示期访问控制：标识只以摘要形式参与比对，明文不出现在任何文件里。
const digestSalt = "mdx7::";
const expectedDigest = "c448802e18eec659a8b34b0255084f839de50c97b06be4422c5d915ed5990540";

const open = ref(false);
const locked = ref(false);
const code = ref("");
const busy = ref(false);
let taps = 0;
let tapStart = 0;

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function applyInert() {
  const root = document.getElementById("app");
  if (root) (root as HTMLElement & { inert?: boolean }).inert = locked.value;
}

async function query() {
  try {
    const { data } = await axios.get("/api/sysinfo", { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } });
    if (data?.code === 200) {
      locked.value = data.data?.s === true;
      applyInert();
    }
  } catch { /* 查询失败时保持默认可用 */ }
}

async function submit() {
  const value = code.value.trim();
  if (!value || busy.value) return;
  const digestText = await digest(digestSalt + value);
  busy.value = true;
  try {
    const { data } = await axios.post("/api/sysinfo", { v: digestText }, { headers: { "x-markdirector-workspace": "1", "x-toonflow-workspace": "1" } });
    const result = data?.data?.r as string | undefined;
    if (data?.code !== 200 || result === "denied") {
      ElMessage.error("访问码不正确");
      return;
    }
    if (result === "on") {
      locked.value = true;
      applyInert();
      open.value = false;
      ElMessage.success("演示保护已开启，重启后依然生效");
    } else if (result === "off") {
      locked.value = false;
      applyInert();
      open.value = false;
      ElMessage.success("已解锁");
    }
    code.value = "";
  } catch {
    ElMessage.error("操作失败，请重试");
  } finally {
    busy.value = false;
  }
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !target.closest(".brand, .brandLogo, .brandName, .brandMark, .sidebarLogo, .agentLogo")) return;
  const now = Date.now();
  if (now - tapStart > 3000) {
    taps = 0;
    tapStart = now;
  }
  taps += 1;
  if (taps >= 5) {
    taps = 0;
    open.value = true;
  }
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick, true);
  void query();
});
onBeforeUnmount(() => document.removeEventListener("click", onDocumentClick, true));
</script>

<style scoped lang="scss">
.guardHint {
  margin: 0 0 14px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.accessShield {
  position: fixed;
  inset: 0;
  z-index: 50000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #10131a;
  backdrop-filter: blur(6px);
}
.shieldCard {
  width: min(360px, 90vw);
  padding: 36px 32px 32px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  text-align: center;
}
.shieldLogo {
  width: 56px;
  height: 56px;
  margin-bottom: 14px;
}
.shieldTitle {
  margin: 0 0 8px;
  color: #f4f6fb;
  font-size: 20px;
}
.shieldHint {
  margin: 0 0 20px;
  color: rgba(244, 246, 251, 0.6);
  font-size: 13px;
  line-height: 1.6;
}
.shieldInput {
  margin-bottom: 16px;
}
.shieldButton {
  width: 100%;
}
</style>
