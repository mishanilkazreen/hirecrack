// Setup for the jsdom (integration) project: jest-dom matchers, cleanup, and the browser APIs
// jsdom does not provide (camera, recorder, audio, object URLs).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { installBrowserStubs } from './helpers';

beforeEach(() => {
  localStorage.clear();
  installBrowserStubs();
});

afterEach(() => {
  cleanup();
});
