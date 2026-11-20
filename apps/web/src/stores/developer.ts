import { defineStore } from "pinia";

export const useDeveloperStore = defineStore("developer", {
  state: () => ({ developerConfirmed: false }),
  persist: { key: "markdirector.developer", storage: localStorage },
});
