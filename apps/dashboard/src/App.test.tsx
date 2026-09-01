import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('dashboard', () => {
  it('renders the authentication screen', () => {
    render(<App />);
    expect(screen.getByText('Depowar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in to your project' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
});
