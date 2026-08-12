import type { NextRequest } from 'next/server';

export type ApiContext = { params: Promise<Record<string, string>> };

export type ApiInput = {
  key: string;
  request: NextRequest;
  params: Record<string, string>;
  method: string;
  body: Record<string, unknown>;
};

export type ApiHandler = (input: ApiInput) => Promise<Response | undefined>;
