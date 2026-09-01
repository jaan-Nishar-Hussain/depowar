import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('dashboard', () => {
  it('renders the project control center and management login', () => {
    render(<App />);
    expect(screen.getByText('Depowar')).toBeInTheDocument();
    expect(screen.getByText('Recipient')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Organizations' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Organization' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Management API key')).toBeInTheDocument();
  });
});
