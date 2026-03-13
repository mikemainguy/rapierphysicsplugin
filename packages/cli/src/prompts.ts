import { select, input, editor, confirm } from '@inquirer/prompts';
import type { IssueType, IssueDetails, ContactInfo } from './templates.js';

export async function promptIssueType(): Promise<IssueType> {
  return select({
    message: 'What would you like to report?',
    choices: [
      { name: 'Bug Report', value: 'bug' as const },
      { name: 'Feature Request', value: 'feature' as const },
      { name: 'Question', value: 'question' as const },
    ],
  });
}

export async function promptTitle(): Promise<string> {
  return input({
    message: 'Title:',
    validate: (value) => value.trim().length > 0 || 'Title is required',
  });
}

export async function promptDescription(): Promise<string> {
  return editor({
    message: 'Description (an editor will open):',
  });
}

export async function promptBugDetails(): Promise<{ stepsToReproduce: string; expectedBehavior: string; actualBehavior: string }> {
  const stepsToReproduce = await input({
    message: 'Steps to reproduce:',
  });

  const expectedBehavior = await input({
    message: 'Expected behavior:',
  });

  const actualBehavior = await input({
    message: 'Actual behavior:',
  });

  return { stepsToReproduce, expectedBehavior, actualBehavior };
}

export async function promptUseCase(): Promise<string> {
  return input({
    message: 'Use case (why do you need this?):',
  });
}

export async function promptIncludeEnv(): Promise<boolean> {
  return confirm({
    message: 'Include environment info?',
    default: true,
  });
}

export async function promptContact(): Promise<ContactInfo | null> {
  const includeContact = await confirm({
    message: 'Include contact info? (optional)',
    default: false,
  });

  if (!includeContact) return null;

  const name = await input({ message: 'Name (optional):', });
  const email = await input({ message: 'Email (optional):', });

  if (!name && !email) return null;

  return {
    name: name || undefined,
    email: email || undefined,
  };
}

export async function promptConfirm(url: string): Promise<boolean> {
  console.log('\nGenerated URL:');
  console.log(url);
  console.log('');

  return confirm({
    message: 'Open in browser?',
    default: true,
  });
}

export async function runInteractiveFlow(
  defaults?: { type?: IssueType; title?: string; description?: string },
): Promise<{ details: IssueDetails; includeEnv: boolean; contact: ContactInfo | null }> {
  const type = defaults?.type ?? await promptIssueType();
  const title = defaults?.title ?? await promptTitle();
  const description = defaults?.description ?? await promptDescription();

  let details: IssueDetails;

  switch (type) {
    case 'bug': {
      const bugExtra = await promptBugDetails();
      details = { type: 'bug', title, description, ...bugExtra };
      break;
    }
    case 'feature': {
      const useCase = await promptUseCase();
      details = { type: 'feature', title, description, useCase };
      break;
    }
    case 'question': {
      details = { type: 'question', title, description };
      break;
    }
  }

  const includeEnv = await promptIncludeEnv();
  const contact = await promptContact();

  return { details, includeEnv, contact };
}
