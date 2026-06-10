import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('app', () => {
  it('renders heading', () => {
    render(<App />)
    expect(screen.getByText('Get started')).toBeInTheDocument()
  })
})
