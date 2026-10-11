// Keep fixture directories outside Git repositories so non-Git workspaces stay non-Git.
import {fileURLToPath} from 'node:url';
process.env.npm_config_cache=fileURLToPath(new URL('./.development/npm',import.meta.url));
