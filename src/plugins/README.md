# CORTEX Plugin System

This directory defines the core plugin architecture for CORTEX.

## Categories

- `connectors`
- `devtools`
- `frontend`
- `rag`
- `automation`

## Runtime Loading

1. Built-in manifests are loaded from `builtinManifests.ts`.
2. Workspace manifests are discovered from:
   - `.cortex/plugins/*.json` when `.cortex` is a directory, or
   - `.cortex_plugins/*.json` when `.cortex` is a file (default in this repo).
3. Plugin package folders are also discovered from:
   - `plugins/<plugin-name>/manifest.json` in the repository root.
4. Plugins are enabled/disabled via config env values:
   - `CORTEX_PLUGINS_ENABLED` (comma-separated allowlist)
   - `CORTEX_PLUGINS_DISABLED` (comma-separated denylist)

## Workspace Manifest Format

```json
{
  "id": "my-plugin-id",
  "name": "My Plugin",
  "version": "1.0.0",
  "category": "devtools",
  "description": "Custom plugin for local workflows",
  "supportedAgents": ["DeveloperAgent", "QualityAgent"],
  "enabledByDefault": true,
  "toolsetKey": "devtools"
}
```

Note: `toolsetKey` must map to a known toolset factory, or the manifest will be ignored.

## Built-in Connector Tools

- `plugin_policy_get` - read current connector/plugin policy
- `plugin_policy_set` - update per-tool policy rules (allow + confirmation)
- `plugin_connector_status` - environment readiness for common integrations
- `plugin_github_issues` - list/create issues via GitHub REST API
- `plugin_slack_webhook_post` - post messages through incoming webhook
- `plugin_notion_search` - search pages/databases via Notion API
- `plugin_sqlite_query` - run read-only SELECT queries on local sqlite files

Unknown plugin tools are denied by default. Add an explicit per-tool `allowed: true` rule to enable a tool. Mutating connectors (`plugin_github_issues` create, `plugin_slack_webhook_post`) also require user confirmation at execution time unless an explicit policy rule changes that requirement.

## Additional Connector Tools

- `plugin_github_prs` - list pull requests
- `plugin_github_pr_comment` - add PR comments
- `plugin_github_pr_merge` - merge pull requests
- `plugin_slack_channel_history` - read Slack channel messages
- `workflow_validate` - validate workflow JSON structure
- `workflow_run` - create workflow run state and audit record
- `workflow_resume` - advance workflow step execution state
- `workflow_cancel` - cancel workflow run with policy gate
- `mesh_envelope_create` - create signed distributed task envelope
- `mesh_envelope_claim` - claim queued envelope for worker
- `mesh_envelope_complete` - complete envelope with result

## Policy File

Connector permissions are controlled by:

- `.cortex/plugins/policy.json` (directory-mode), or
- `.cortex_plugins/policy.json` (file-mode fallback)

Policy schema:

```json
{
  "defaultAllow": false,
  "tools": {
    "plugin_github_pr_merge": {
      "allowed": true,
      "requireConfirmation": true
    }
  }
}
```
