#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { collectEnvironment } from './collect-env.js';
import { buildBody } from './templates.js';
import { buildIssueUrl } from './build-url.js';
import type { IssueType, IssueDetails, ContactInfo } from './templates.js';

const HELP_TEXT = `
rapierphysicsplugin - Report bugs and request features

Usage:
  npx @rapierphysicsplugin/cli [options]

Options:
  --type <bug|feature|question>  Issue type
  --title <string>               Issue title (required for non-interactive)
  --description <string>         Issue description
  --no-env                       Skip environment info
  --no-open                      Print URL instead of opening browser
  --email <string>               Contact email (optional)
  --name <string>                Contact name (optional)
  --help                         Show this help message

Examples:
  npx @rapierphysicsplugin/cli
  npx @rapierphysicsplugin/cli --type bug --title "Crash on startup"
  npx @rapierphysicsplugin/cli --type feature --title "Add X" --description "..." --no-open
`.trim();

interface CliOptions {
  type?: IssueType;
  title?: string;
  description?: string;
  env: boolean;
  open: boolean;
  email?: string;
  name?: string;
  help: boolean;
}

function parseCliArgs(args: string[]): CliOptions {
  const { values } = parseArgs({
    args,
    options: {
      type: { type: 'string', short: 't' },
      title: { type: 'string' },
      description: { type: 'string', short: 'd' },
      'no-env': { type: 'boolean', default: false },
      'no-open': { type: 'boolean', default: false },
      email: { type: 'string' },
      name: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  const typeVal = values.type as string | undefined;
  if (typeVal && !['bug', 'feature', 'question'].includes(typeVal)) {
    throw new Error(`Invalid type "${typeVal}". Must be one of: bug, feature, question`);
  }

  return {
    type: typeVal as IssueType | undefined,
    title: values.title as string | undefined,
    description: values.description as string | undefined,
    env: !values['no-env'],
    open: !values['no-open'],
    email: values.email as string | undefined,
    name: values.name as string | undefined,
    help: values.help as boolean,
  };
}

function hasAllRequiredFlags(opts: CliOptions): opts is CliOptions & { type: IssueType; title: string } {
  return !!opts.type && !!opts.title;
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP_TEXT);
    return;
  }

  let details: IssueDetails;
  let includeEnv = opts.env;
  let contact: ContactInfo | null = null;

  if (opts.email || opts.name) {
    contact = {
      email: opts.email,
      name: opts.name,
    };
  }

  if (hasAllRequiredFlags(opts)) {
    const description = opts.description ?? '';

    switch (opts.type) {
      case 'bug':
        details = {
          type: 'bug',
          title: opts.title,
          description,
          stepsToReproduce: '',
          expectedBehavior: '',
          actualBehavior: '',
        };
        break;
      case 'feature':
        details = {
          type: 'feature',
          title: opts.title,
          description,
          useCase: '',
        };
        break;
      case 'question':
        details = {
          type: 'question',
          title: opts.title,
          description,
        };
        break;
    }
  } else {
    const { runInteractiveFlow } = await import('./prompts.js');
    const result = await runInteractiveFlow({
      type: opts.type,
      title: opts.title,
      description: opts.description,
    });
    details = result.details;
    includeEnv = result.includeEnv;
    contact = result.contact ?? contact;
  }

  const env = includeEnv ? collectEnvironment() : null;
  const body = buildBody(details, env, contact);
  const url = buildIssueUrl(details.type, details.title, body);

  if (!opts.open) {
    console.log(url);
    return;
  }

  const openModule = await import('open');
  const openFn = openModule.default;
  await openFn(url);
  console.log('Opened browser to create issue.');
}

main().catch((error: Error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
