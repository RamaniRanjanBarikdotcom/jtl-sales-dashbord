import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CopilotConversation } from '@/components/copilot/CopilotConversation';
import { COPILOT_SUGGESTIONS } from '@/lib/copilot-suggestions';

const props = { messages: [], busy: false, error: '' };

describe('CopilotConversation', () => {
    it('exposes every suggestion in the dropdown', () => {
        render(<CopilotConversation {...props} onAsk={vi.fn()} />);
        fireEvent.click(screen.getByLabelText('Suggested questions'));
        const options = screen.getAllByRole('option');
        const expected = COPILOT_SUGGESTIONS.flatMap((group) => group.items);
        expect(options).toHaveLength(expected.length);
        for (const item of expected) expect(screen.getByRole('option', { name: item.label })).toBeTruthy();
    });

    it('asks the suggestion question, not its short label', () => {
        const onAsk = vi.fn();
        const first = COPILOT_SUGGESTIONS[0].items[0];
        render(<CopilotConversation {...props} onAsk={onAsk} />);
        fireEvent.click(screen.getByLabelText('Suggested questions'));
        fireEvent.click(screen.getByRole('option', { name: first.label }));
        expect(onAsk).toHaveBeenCalledWith(first.question);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('sends a typed question and clears the input', () => {
        const onAsk = vi.fn();
        render(<CopilotConversation {...props} onAsk={onAsk} />);
        const input = screen.getByLabelText('Ask a sales question') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'How were sales last week?' } });
        fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
        expect(onAsk).toHaveBeenCalledWith('How were sales last week?');
        expect(input.value).toBe('');
    });

    it('sends a typed question on Enter', () => {
        const onAsk = vi.fn();
        render(<CopilotConversation {...props} onAsk={onAsk} />);
        fireEvent.change(screen.getByLabelText('Ask a sales question'), { target: { value: 'Revenue today?' } });
        fireEvent.keyDown(screen.getByLabelText('Ask a sales question'), { key: 'Enter' });
        expect(onAsk).toHaveBeenCalledWith('Revenue today?');
    });

    it('ignores an empty question', () => {
        const onAsk = vi.fn();
        render(<CopilotConversation {...props} onAsk={onAsk} />);
        fireEvent.change(screen.getByLabelText('Ask a sales question'), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
        expect(onAsk).not.toHaveBeenCalled();
    });

    it('does not fire a second question while one is in flight', () => {
        const onAsk = vi.fn();
        render(<CopilotConversation {...props} busy onAsk={onAsk} />);
        fireEvent.click(screen.getByLabelText('Suggested questions'));
        fireEvent.click(screen.getAllByRole('option')[0]);
        expect(onAsk).not.toHaveBeenCalled();
    });

    it('shows the error text the caller passes rather than swallowing it', () => {
        render(<CopilotConversation {...props} error="Copilot is not configured." onAsk={vi.fn()} />);
        expect(screen.getByText('Copilot is not configured.')).toBeTruthy();
    });

    it('refuses to send while the Copilot is unavailable', () => {
        // Asking anyway produced a masked "Internal server error" in the browser.
        const onAsk = vi.fn();
        render(<CopilotConversation {...props} disabled onAsk={onAsk} />);
        const input = screen.getByLabelText('Ask a sales question') as HTMLInputElement;
        expect(input.disabled).toBe(true);
        fireEvent.keyDown(input, { key: 'Enter' });
        fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
        expect(onAsk).not.toHaveBeenCalled();
    });
});
