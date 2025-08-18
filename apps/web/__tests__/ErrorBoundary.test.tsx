import React from 'react';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

// Mock console.error to avoid noise in test output
const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

// Component that throws an error
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
};

// Mock fetch globally
global.fetch = jest.fn();

describe('ErrorBoundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock window.posthog
    (global as any).window = {
      posthog: {
        capture: jest.fn(),
      },
      location: {
        href: 'http://localhost:3000/test',
      },
      navigator: {
        userAgent: 'test-agent',
      },
    };
  });

  afterEach(() => {
    consoleSpy.mockClear();
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('No error')).toBeInTheDocument();
  });

  it('renders error UI when there is an error', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
    expect(screen.getByText('Reload Page')).toBeInTheDocument();
    expect(screen.getByText('Go Back')).toBeInTheDocument();
  });

  it('captures error to PostHog when available', () => {
    const mockCapture = jest.fn();
    (global as any).window.posthog.capture = mockCapture;

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(mockCapture).toHaveBeenCalledWith('error_boundary', {
      error: 'Error: Test error',
      componentStack: expect.any(String),
    });
  });

  it('sends error to analytics endpoint', () => {
    const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(fetch).toHaveBeenCalledWith('/api/v1/analytics/error', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Test error',
        stack: expect.any(String),
        componentStack: expect.any(String),
        url: 'http://localhost:3000/test',
        userAgent: 'test-agent',
        timestamp: expect.any(String),
      }),
    });
  });

  it('shows error details in development mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Error Details (Development)')).toBeInTheDocument();

    process.env.NODE_ENV = originalEnv;
  });

  it('handles missing PostHog gracefully', () => {
    (global as any).window.posthog = undefined;

    expect(() => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );
    }).not.toThrow();

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('handles fetch errors gracefully', () => {
    const mockFetch = fetch as jest.MockedFunction<typeof fetch>;
    mockFetch.mockRejectedValue(new Error('Network error'));

    expect(() => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );
    }).not.toThrow();

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});