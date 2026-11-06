import {build} from 'esbuild';
await build({entryPoints:['ui/arc-chat.tsx'],bundle:true,outfile:'arc-chat.js',format:'iife',globalName:'DashboardArc',jsx:'automatic',minify:true,legalComments:'eof',define:{'process.env.NODE_ENV':'"production"'},loader:{'.module.css':'local-css'}});
