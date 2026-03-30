import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Paginator } from '@/components/ui/Paginator';

describe('Paginator', () => {
  it('renders nothing when total fits on one page', () => {
    const { container } = render(
      <Paginator page={1} total={30} limit={50} onPageChange={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows correct range text', () => {
    render(<Paginator page={2} total={150} limit={50} onPageChange={vi.fn()} />);
    expect(screen.getByText('Showing 51–100 of 150')).toBeTruthy();
  });

  it('calls onPageChange with correct page on Next click', () => {
    const onPageChange = vi.fn();
    render(<Paginator page={1} total={200} limit={50} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByText('Next →'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('disables Prev button on first page', () => {
    render(<Paginator page={1} total={200} limit={50} onPageChange={vi.fn()} />);
    const prevBtn = screen.getByText('← Prev') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });

  it('disables Next button on last page', () => {
    render(<Paginator page={4} total={200} limit={50} onPageChange={vi.fn()} />);
    const nextBtn = screen.getByText('Next →') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });
});
