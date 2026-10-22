export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

import { REGISTRY_PART_1 } from "./registry_part1";
import { REGISTRY_PART_2 } from "./registry_part2";
import { REGISTRY_PART_3 } from "./registry_part3";
import { REGISTRY_PART_4 } from "./registry_part4";
import { REGISTRY_PART_5 } from "./registry_part5";

export const MCP_TOOLS: McpToolDefinition[] = [
  ...REGISTRY_PART_1,
  ...REGISTRY_PART_2,
  ...REGISTRY_PART_3,
  ...REGISTRY_PART_4,
  ...REGISTRY_PART_5,
];
