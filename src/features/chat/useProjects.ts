import { useCallback, useEffect, useState } from "react";

import type { Project } from "./chat.types";
import { listProjects, createProject, renameProject, deleteProject } from "./projectsApi";

export interface UseProjects {
  projects: Project[];
  /** create, rename and remove reject with the ProjectApiError the caller shows inline */
  create: (name: string) => Promise<Project>;
  rename: (projectId: string, name: string) => Promise<void>;
  remove: (projectId: string, withSessions: boolean) => Promise<void>;
  /** re-read the server order after something outside this hook changes last activity */
  reload: () => Promise<void>;
}

/** the caller's projects, in the server's order (most recently active first). Rename and remove
 * are optimistic with rollback, matching the pin star's behaviour; create waits for the server
 * because the row cannot be drawn without the id it assigns. */
export function useProjects(): UseProjects {
  const [projects, setProjects] = useState<Project[]>([]);

  const reload = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (err) {
      // an unreachable projects endpoint must not take the chat history down with it
      console.error("Failed to load projects:", err);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(async (name: string) => {
    const project = await createProject(name);
    setProjects((prev) => [project, ...prev]);
    return project;
  }, []);

  const rename = useCallback(async (projectId: string, name: string) => {
    let previous: Project | undefined;
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        previous = p;
        return { ...p, name };
      }),
    );
    try {
      await renameProject(projectId, name);
    } catch (err) {
      if (previous) {
        const restored = previous;
        setProjects((prev) => prev.map((p) => (p.id === projectId ? restored : p)));
      }
      throw err;
    }
  }, []);

  const remove = useCallback(async (projectId: string, withSessions: boolean) => {
    let removed: { project: Project; index: number } | undefined;
    setProjects((prev) => {
      const index = prev.findIndex((p) => p.id === projectId);
      if (index >= 0) removed = { project: prev[index], index };
      return prev.filter((p) => p.id !== projectId);
    });
    try {
      await deleteProject(projectId, { withSessions });
    } catch (err) {
      if (removed) {
        const { project, index } = removed;
        setProjects((prev) => {
          const next = [...prev];
          next.splice(index, 0, project);
          return next;
        });
      }
      throw err;
    }
  }, []);

  return { projects, create, rename, remove, reload };
}
