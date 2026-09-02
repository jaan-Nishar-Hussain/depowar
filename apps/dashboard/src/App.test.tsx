import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('dashboard', () => {
  it('renders the authentication screen', () => {
    render(<App />);
    expect(screen.getByText('Depowar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in to your project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });
});
