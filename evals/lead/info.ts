import { z } from "zod";

const TOOL_ENTRY = z.object({
  logicalPath: z.string(),
  slug: z.string().optional(),
});

const AGENT_INFO = z.object({
  mode: z.string(),
  tools: z.object({
    dynamic: z.array(TOOL_ENTRY),
    static: z.array(TOOL_ENTRY),
  }),
});

export type AgentInfo = z.infer<typeof AGENT_INFO>;

/** The slice of an eval's target that reads from the running agent. */
export interface InfoTarget {
  readonly fetch: (path: string) => Promise<Response>;
}

/** What the running agent reports about itself at `/eve/v1/info`. */
export const readAgentInfo = async (target: InfoTarget): Promise<AgentInfo> => {
  const response = await target.fetch("/eve/v1/info");
  return AGENT_INFO.parse(await response.json());
};

/**
 * The tools the app declares, by the names eve knows them under: the file
 * path and the slug. A dynamic tool is listed once, as the tool that
 * resolves the real ones at runtime.
 */
export const declaredToolNames = (info: AgentInfo): readonly string[] =>
  [...info.tools.static, ...info.tools.dynamic].flatMap((tool) =>
    tool.slug === undefined ? [tool.logicalPath] : [tool.logicalPath, tool.slug]
  );

const MERGE_LIKE = /merge/iu;

/** Whether a tool name, slug or path is a merge tool: the lead never has one. */
export const isMergeLike = (name: string): boolean => MERGE_LIKE.test(name);

/** Whether any of the names is merge-like. */
export const mountsMergeTool = (names: readonly string[]): boolean =>
  names.some(isMergeLike);
