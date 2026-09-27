"""Developer SDK & Interactive Documentation Portal — Antigravity WebUI v0.5.0

REST API serving the interactive SDK documentation, OpenAPI specs,
code examples, and plugin development guides.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

logger = logging.getLogger("antigravity.api.sdk_portal")

router = APIRouter(prefix="/api/sdk", tags=["sdk"])

# SDK Plugin API specification
PLUGIN_API_SPEC = {
    "openrpc": "1.3.2",
    "info": {
        "title": "Antigravity Plugin SDK",
        "description": "API for developing third-party plugins for Antigravity WebUI",
        "version": "0.5.0",
        "contact": {
            "name": "Antigravity Team",
            "url": "https://github.com/antigravity-webui"
        }
    },
    "methods": [
        {
            "name": "antigravity.plugins.registerCommand",
            "description": "Register a custom slash command that can be invoked from the chat input",
            "params": [
                {"name": "cmd", "description": "Command slug (e.g. '/my-command')", "required": True},
                {"name": "description", "description": "Human-readable description", "required": True},
                {"name": "arg", "description": "Argument hint (e.g. '<file>')", "required": False},
                {"name": "handler", "description": "Handler function reference (plugin scope)", "required": True},
            ],
            "result": {
                "name": "registration",
                "description": "Command registration confirmation",
            },
            "examples": [
                {
                    "name": "Register /lint command",
                    "params": [
                        {"name": "cmd", "value": "/lint"},
                        {"name": "description", "value": "Run ESLint on the current file"},
                        {"name": "arg", "value": "<file>"},
                        {"name": "handler", "value": "myPlugin.handleLint"},
                    ]
                }
            ]
        },
        {
            "name": "antigravity.plugins.registerTool",
            "description": "Register a custom agent tool that can be called during agent execution",
            "params": [
                {"name": "name", "description": "Tool name", "required": True},
                {"name": "description", "description": "Tool description for the agent", "required": True},
                {"name": "parameters", "description": "JSON Schema for tool parameters", "required": True},
                {"name": "handler", "description": "Handler function reference", "required": True},
            ],
        },
        {
            "name": "antigravity.plugins.registerView",
            "description": "Register a custom UI view panel accessible from the sidebar",
            "params": [
                {"name": "viewId", "description": "Unique view identifier", "required": True},
                {"name": "title", "description": "Panel title", "required": True},
                {"name": "componentUrl", "description": "URL to the view's Web Component bundle", "required": True},
                {"name": "icon", "description": "Lucide icon name", "required": False},
            ],
        },
    ],
    "components": {
        "schemas": {
            "PluginManifest": {
                "type": "object",
                "required": ["slug", "name", "version", "entry_point", "scopes"],
                "properties": {
                    "slug": {"type": "string", "pattern": "^[a-z0-9][a-z0-9_\\-]{1,60}$"},
                    "name": {"type": "string"},
                    "version": {"type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$"},
                    "description": {"type": "string"},
                    "entry_point": {"type": "string", "description": "URL to plugin's Wasm/JS bundle"},
                    "scopes": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "register_command",
                                "register_tool",
                                "register_view",
                                "read_workspace",
                                "write_workspace",
                                "run_terminal",
                                "chat_access",
                            ]
                        }
                    },
                    "author": {"type": "string"},
                    "homepage": {"type": "string", "format": "uri"},
                }
            }
        }
    }
}

EXAMPLES = {
    "typescript": {
        "description": "TypeScript plugin example",
        "code": """// Antigravity Plugin — TypeScript Example
// File: my-plugin/index.ts

import type { AntigravityPlugin } from '@antigravity/sdk';

const plugin: AntigravityPlugin = {
  manifest: {
    slug: 'my-echo-plugin',
    name: 'Echo Plugin',
    version: '1.0.0',
    scopes: ['register_command', 'chat_access'],
  },

  async onLoad(api) {
    // Register a /echo slash command
    api.registerCommand({
      cmd: '/echo',
      description: 'Echo text back to the chat',
      arg: '<text>',
      handler: async (args) => {
        await api.chat.sendMessage(args.join(' '));
      },
    });

    // Register a custom agent tool
    api.registerTool({
      name: 'echo_message',
      description: 'Echo any message',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' }
        },
        required: ['message']
      },
      handler: async ({ message }) => {
        return { echoed: message };
      },
    });

    console.log('[Echo Plugin] Loaded successfully');
  },
};

export default plugin;
"""
    },
    "python": {
        "description": "Python backend tool plugin example",
        "code": """# Antigravity Plugin — Python Backend Example
# File: my-plugin/plugin.py

from antigravity_sdk import PluginBase, register_tool

class MyPlugin(PluginBase):
    slug = "my-python-plugin"
    name = "Python Example Plugin"
    version = "1.0.0"
    scopes = ["register_tool", "read_workspace"]

    @register_tool(
        description="Count lines in a workspace file",
        parameters={"file_path": {"type": "string"}}
    )
    def count_lines(self, file_path: str) -> dict:
        try:
            with open(file_path) as f:
                count = sum(1 for _ in f)
            return {"file": file_path, "line_count": count}
        except FileNotFoundError:
            return {"error": f"File not found: {file_path}"}

plugin = MyPlugin()
"""
    }
}

GUIDES = [
    {
        "id": "getting-started",
        "title": "Getting Started",
        "description": "Introduction to the Antigravity Plugin SDK",
        "content": """## Getting Started with Antigravity Plugins

The Antigravity Plugin SDK allows you to extend the WebUI with custom commands,
agent tools, and UI views. Plugins run in an isolated Wasm sandbox with
explicit permission scopes.

### Quick Start

1. **Create a manifest** defining your plugin slug, version, and required scopes
2. **Implement your plugin** in TypeScript or as a Wasm module
3. **Register via API** using `POST /api/plugins` with your manifest
4. **Invoke methods** via `POST /api/plugins/{slug}/invoke`

### Permission Scopes

| Scope | Description |
|-------|-------------|
| `register_command` | Add custom `/slash` commands |
| `register_tool` | Add custom agent tools |
| `register_view` | Add sidebar UI panels |
| `read_workspace` | Read workspace files |
| `write_workspace` | Write workspace files |
| `run_terminal` | Execute terminal commands |
| `chat_access` | Read/write chat messages |
"""
    },
    {
        "id": "plugin-lifecycle",
        "title": "Plugin Lifecycle",
        "description": "Understanding the plugin loading and execution lifecycle",
        "content": """## Plugin Lifecycle

### Phases

1. **Registration** — Plugin manifest is validated and stored in the sandbox registry
2. **Load** — Plugin's Wasm/JS bundle is fetched and initialized in an isolated Worker
3. **Execution** — Plugin methods are invoked via the sandboxed API
4. **Unload** — Plugin is disabled or removed, Worker is terminated

### Sandbox Security

All plugins run in a dedicated Web Worker with:
- No direct DOM access
- Restricted filesystem access (scoped to granted permissions)
- Message-passing communication only with the host UI
- Automatic timeout enforcement (30s per method call)
"""
    },
    {
        "id": "watchdog-integration",
        "title": "Watchdog Integration",
        "description": "Integrating with the Self-Healing Watchdog Sentinel",
        "content": """## Watchdog Sentinel Integration

Plugins can subscribe to watchdog alerts and contribute custom health checks.

### Subscribing to Alerts (requires `chat_access` scope)

```typescript
api.watchdog.onAlert((alert) => {
  if (alert.category === 'typescript' && alert.severity === 'error') {
    // Automatically suggest a fix
    api.chat.sendMessage(`@agent Fix TypeScript error: ${alert.message}`);
  }
});
```

### Custom Health Check

```typescript
api.watchdog.registerCheck({
  id: 'my-custom-check',
  interval: 60, // seconds
  handler: async () => {
    const ok = await myCustomCheck();
    return { healthy: ok, message: ok ? 'All good' : 'Issue detected' };
  }
});
```
"""
    }
]


@router.get("")
def sdk_overview():
    """SDK portal overview."""
    return {
        "name": "Antigravity Plugin SDK",
        "version": "0.5.0",
        "description": "Build and install custom plugins for Antigravity WebUI",
        "endpoints": {
            "spec": "/api/sdk/spec",
            "examples": "/api/sdk/examples",
            "guides": "/api/sdk/guides",
        }
    }


@router.get("/spec")
def get_openrpc_spec():
    """Return the OpenRPC plugin API specification."""
    return JSONResponse(content=PLUGIN_API_SPEC)


@router.get("/examples")
def get_code_examples():
    """Return SDK code examples in TypeScript and Python."""
    return {"examples": EXAMPLES}


@router.get("/examples/{lang}")
def get_example_by_lang(lang: str):
    """Return a code example for a specific language."""
    example = EXAMPLES.get(lang)
    if not example:
        return JSONResponse(
            status_code=404,
            content={"detail": f"No example for language '{lang}'. Available: {list(EXAMPLES.keys())}"}
        )
    return {"language": lang, **example}


@router.get("/guides")
def list_guides():
    """List all available developer guides."""
    return {
        "guides": [{"id": g["id"], "title": g["title"], "description": g["description"]} for g in GUIDES]
    }


@router.get("/guides/{guide_id}")
def get_guide(guide_id: str):
    """Return a specific guide by ID."""
    guide = next((g for g in GUIDES if g["id"] == guide_id), None)
    if not guide:
        return JSONResponse(status_code=404, content={"detail": f"Guide '{guide_id}' not found"})
    return guide


@router.get("/manifest-schema")
def get_manifest_schema():
    """Return JSON Schema for PluginManifest."""
    return PLUGIN_API_SPEC["components"]["schemas"]["PluginManifest"]
