import { describe, expect, it } from 'vitest';

import { parseClaudeAssistantToolUseEvents } from '../src/services/providers/claudeCode.js';
import { parseOpenCodeToolUseEvent } from '../src/services/providers/opencode.js';

describe('provider tool_use parsing', () => {
  it('parses Claude Code assistant tool_use content blocks', () => {
    const events = parseClaudeAssistantToolUseEvents({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '我先看文件' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'README.md' } },
        ],
      },
    }, 'agent-1');

    expect(events).toEqual([
      {
        type: 'tool_use',
        agentId: 'agent-1',
        toolName: 'Read',
        toolInput: { file_path: 'README.md' },
        callId: 'toolu_1',
      },
    ]);
  });

  it('parses OpenCode documented tool_use part format', () => {
    expect(parseOpenCodeToolUseEvent({
      type: 'tool_use',
      part: {
        id: 'part-1',
        type: 'tool_use',
        tool: 'bash',
        state: { input: { command: 'pwd' } },
      },
    }, 'agent-1')).toEqual({
      type: 'tool_use',
      agentId: 'agent-1',
      toolName: 'bash',
      toolInput: { command: 'pwd' },
      callId: 'part-1',
    });
  });

  it('parses OpenCode runtime tool part format', () => {
    expect(parseOpenCodeToolUseEvent({
      type: 'tool_use',
      part: {
        type: 'tool',
        tool: 'read',
        callID: 'call-1',
        input: { path: 'package.json' },
      },
    }, 'agent-1')).toEqual({
      type: 'tool_use',
      agentId: 'agent-1',
      toolName: 'read',
      toolInput: { path: 'package.json' },
      callId: 'call-1',
    });
  });
});
