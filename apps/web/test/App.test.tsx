import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

describe('web host', () => {
  it('renders the PayMesh landing + deposit widget', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'PayMesh' })).toBeInTheDocument();
    expect(screen.getByTestId('paymesh-deposit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Wallet' })).toBeInTheDocument();
  });
});