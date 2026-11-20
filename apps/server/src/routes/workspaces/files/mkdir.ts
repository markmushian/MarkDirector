import { lstat, mkdir } from "@markdirector/file";
import { relative } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.post("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().max(4096) }), async (req, res) => {
  const { directory, path } = await u.workspaceFile.resolveWorkspaceFile(req, req.body.directory, req.body.path);
  u.workspaceFile.protectWorkspaceRoot(directory, path);
  const release = u.workspaceFile.lockWorkspaceFiles([path]);
  try {
    await mkdir(path);
    res.json(success({ created: true }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || relative(directory, path).toLowerCase() !== "assets") throw error;
    const existing = await lstat(path);
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw error;
    res.json(success({ created: false }));
  } finally { release(); }
});
