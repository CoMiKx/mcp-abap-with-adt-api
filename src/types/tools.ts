export interface SchemaProperty {
  type?: string;
  description?: string;
  optional?: boolean;
  enum?: string[];
  items?: { type: string };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, SchemaProperty>;
    required?: string[];
  };
}
