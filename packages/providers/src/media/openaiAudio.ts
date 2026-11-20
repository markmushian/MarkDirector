const rules = [
  {
    type: "input",
    field: "apiUrl" as const,
    title: "API 地址",
    value: "",
    props: { placeholder: "https://api.example.com/v1" },
  },
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
] as const;

export default {
  id: "openaiAudio" as const,
  label: "通用音频（OpenAI 兼容）",
  icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjY2FhMDRjIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iOSIgeT0iMiIgd2lkdGg9IjYiIGhlaWdodD0iMTIiIHJ4PSIzIi8+PHBhdGggZD0iTTUgMTBhNyA3IDAgMCAwIDE0IDBNMTIgMTd2NSIvPjwvc3ZnPg==",
  version: "1.0.0",
  readme: `## 通用音频（OpenAI 兼容）

任何提供标准 POST /v1/audio/speech 接口的服务都可以接入，例如自建 one-api / new-api 聚合网关、国内兼容 OpenAI 协议的语音服务。

配置步骤：
1. 「API 地址」填到 /v1 结尾，例如 https://api.example.com/v1（不要带 /audio/speech）。
2. 填入该服务的 API Key。
3. 在画布音频生成节点选择模型与音色，输入文本即可生成。

生成的音频会按所选格式保存到项目素材中，默认 mp3。若服务不支持所选音色或格式，请在其控制台确认后调整。`,
  rules,
  models: [
    {
      id: "tts-1",
      label: "TTS-1 语音合成",
      type: "audio",
      voices: [
        { title: "女声 alloy", voice: "alloy" },
        { title: "女声 nova", voice: "nova" },
        { title: "女声 shimmer", voice: "shimmer" },
        { title: "男声 echo", voice: "echo" },
        { title: "男声 onyx", voice: "onyx" },
        { title: "中性 fable", voice: "fable" },
      ],
    },
    {
      id: "tts-1-hd",
      label: "TTS-1 HD 高清语音",
      type: "audio",
      voices: [
        { title: "女声 alloy", voice: "alloy" },
        { title: "女声 nova", voice: "nova" },
        { title: "女声 shimmer", voice: "shimmer" },
        { title: "男声 echo", voice: "echo" },
        { title: "男声 onyx", voice: "onyx" },
        { title: "中性 fable", voice: "fable" },
      ],
    },
    {
      id: "gpt-4o-mini-tts",
      label: "GPT-4o Mini TTS",
      type: "audio",
      voices: [
        { title: "女声 alloy", voice: "alloy" },
        { title: "女声 nova", voice: "nova" },
        { title: "女声 shimmer", voice: "shimmer" },
        { title: "男声 echo", voice: "echo" },
        { title: "男声 onyx", voice: "onyx" },
        { title: "中性 fable", voice: "fable" },
      ],
    },
  ] satisfies ProviderModel[],
  async generateAudio(request: AudioRequest): Promise<MediaAsset[]> {
    const rawUrl = typeof this.config.apiUrl === "string" ? this.config.apiUrl.trim() : "";
    const apiKey = typeof this.config.apiKey === "string" ? this.config.apiKey.trim() : "";
    if (!rawUrl) throw new Error("请在媒体模型设置中填写 API 地址");
    if (!apiKey) throw new Error("请在媒体模型设置中填写 API Key");
    const text = (typeof request.text === "string" ? request.text : typeof request.prompt === "string" ? request.prompt : "").trim();
    if (!text) throw new Error("请输入要合成的文本");

    const baseUrl = rawUrl.replace(/\/+$/, "");
    const format = (typeof request.format === "string" ? request.format.toLowerCase() : "mp3") || "mp3";
    const responseFormat = ["mp3", "wav", "ogg", "flac"].includes(format) ? format : "mp3";
    const mimeType = responseFormat === "wav" ? "audio/wav" : responseFormat === "ogg" ? "audio/ogg" : responseFormat === "flac" ? "audio/flac" : "audio/mpeg";

    const body: Record<string, unknown> = {
      model: request.model,
      input: text,
      voice: typeof request.voice === "string" && request.voice.trim() ? request.voice.trim() : "alloy",
      response_format: responseFormat,
    };
    if (typeof request.speed === "number" && Number.isFinite(request.speed)) {
      body.speed = Math.min(4, Math.max(0.25, request.speed));
    }
    if (request.other && typeof request.other === "object") {
      for (const [key, value] of Object.entries(request.other)) {
        if (!["model", "input", "voice", "response_format", "speed"].includes(key)) body[key] = value;
      }
    }

    const response = await this.tool.fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: this.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(this.tool.errorMessage(detail) || `音频生成失败：HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.byteLength) throw new Error("音频服务返回了空文件");
    return [{ mediaType: "audio", type: "base64", data: bytes.toString("base64"), mimeType }];
  },
} satisfies ProviderDefinition<typeof rules>;
