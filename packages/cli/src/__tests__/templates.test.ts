import { describe, it, expect } from 'vitest';
import { buildBody, buildBugBody, buildFeatureBody, buildQuestionBody } from '../templates.js';
import type { EnvironmentInfo } from '../collect-env.js';
import type { BugDetails, FeatureDetails, QuestionDetails, ContactInfo } from '../templates.js';

const mockEnv: EnvironmentInfo = {
  nodeVersion: 'v20.0.0',
  platform: 'darwin',
  arch: 'arm64',
  packages: {
    '@rapierphysicsplugin/shared': '1.0.13',
    '@babylonjs/core': '8.0.0',
  },
};

const mockContact: ContactInfo = {
  name: 'Test User',
  email: 'test@example.com',
};

describe('buildBugBody', () => {
  const details: BugDetails = {
    type: 'bug',
    title: 'Test Bug',
    description: 'Something broke',
    stepsToReproduce: '1. Do X\n2. Do Y',
    expectedBehavior: 'Should work',
    actualBehavior: 'Crashes',
  };

  it('should include all bug sections', () => {
    const body = buildBugBody(details, mockEnv, null);

    expect(body).toContain('## Description');
    expect(body).toContain('Something broke');
    expect(body).toContain('## Steps to Reproduce');
    expect(body).toContain('1. Do X');
    expect(body).toContain('## Expected Behavior');
    expect(body).toContain('Should work');
    expect(body).toContain('## Actual Behavior');
    expect(body).toContain('Crashes');
  });

  it('should include environment in details block', () => {
    const body = buildBugBody(details, mockEnv, null);

    expect(body).toContain('<details>');
    expect(body).toContain('</details>');
    expect(body).toContain('v20.0.0');
    expect(body).toContain('darwin');
    expect(body).toContain('@rapierphysicsplugin/shared');
    expect(body).toContain('1.0.13');
  });

  it('should omit environment when null', () => {
    const body = buildBugBody(details, null, null);

    expect(body).not.toContain('<details>');
    expect(body).not.toContain('Environment');
  });

  it('should include contact info when provided', () => {
    const body = buildBugBody(details, null, mockContact);

    expect(body).toContain('## Contact');
    expect(body).toContain('Test User');
    expect(body).toContain('test@example.com');
  });

  it('should omit contact section when null', () => {
    const body = buildBugBody(details, null, null);

    expect(body).not.toContain('## Contact');
  });
});

describe('buildFeatureBody', () => {
  const details: FeatureDetails = {
    type: 'feature',
    title: 'New Feature',
    description: 'Add a thing',
    useCase: 'I need it for...',
  };

  it('should include feature sections', () => {
    const body = buildFeatureBody(details, mockEnv, null);

    expect(body).toContain('## Description');
    expect(body).toContain('Add a thing');
    expect(body).toContain('## Use Case');
    expect(body).toContain('I need it for...');
  });

  it('should not include bug-specific sections', () => {
    const body = buildFeatureBody(details, mockEnv, null);

    expect(body).not.toContain('Steps to Reproduce');
    expect(body).not.toContain('Expected Behavior');
    expect(body).not.toContain('Actual Behavior');
  });
});

describe('buildQuestionBody', () => {
  const details: QuestionDetails = {
    type: 'question',
    title: 'How to X?',
    description: 'I want to know...',
  };

  it('should include description only', () => {
    const body = buildQuestionBody(details, null, null);

    expect(body).toContain('## Description');
    expect(body).toContain('I want to know...');
  });

  it('should not include bug or feature sections', () => {
    const body = buildQuestionBody(details, null, null);

    expect(body).not.toContain('Steps to Reproduce');
    expect(body).not.toContain('Use Case');
  });
});

describe('buildBody', () => {
  it('should dispatch to bug template', () => {
    const details: BugDetails = {
      type: 'bug',
      title: 'Bug',
      description: 'desc',
      stepsToReproduce: 'steps',
      expectedBehavior: 'expected',
      actualBehavior: 'actual',
    };
    const body = buildBody(details, null, null);
    expect(body).toContain('Steps to Reproduce');
  });

  it('should dispatch to feature template', () => {
    const details: FeatureDetails = {
      type: 'feature',
      title: 'Feature',
      description: 'desc',
      useCase: 'use case',
    };
    const body = buildBody(details, null, null);
    expect(body).toContain('Use Case');
  });

  it('should dispatch to question template', () => {
    const details: QuestionDetails = {
      type: 'question',
      title: 'Question',
      description: 'desc',
    };
    const body = buildBody(details, null, null);
    expect(body).not.toContain('Use Case');
    expect(body).not.toContain('Steps to Reproduce');
  });

  it('should include partial contact info', () => {
    const details: QuestionDetails = {
      type: 'question',
      title: 'Q',
      description: 'desc',
    };
    const body = buildBody(details, null, { email: 'a@b.com' });
    expect(body).toContain('a@b.com');
    expect(body).not.toContain('**Name:**');
  });

  it('should include environment packages', () => {
    const details: QuestionDetails = {
      type: 'question',
      title: 'Q',
      description: 'desc',
    };
    const body = buildBody(details, mockEnv, null);
    expect(body).toContain('@babylonjs/core');
    expect(body).toContain('8.0.0');
    expect(body).toContain('arm64');
  });
});
