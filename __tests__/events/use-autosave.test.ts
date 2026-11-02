import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutosave } from '@/components/events/builder/use-autosave';

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not save the value it starts with', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave('a', save, 800));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('two edits within the delay save once, with the latest value', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }) => useAutosave(v, save, 800),
      { initialProps: { v: 'a' } }
    );
    rerender({ v: 'b' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    rerender({ v: 'c' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('c');
    expect(result.current.state).toBe('saved');
    expect(result.current.savedAt).toBeInstanceOf(Date);
  });

  it('keeps one request in flight and saves the newest value after it', async () => {
    let release!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((r) => (release = () => r()))
      )
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }) => useAutosave(v, save, 800),
      { initialProps: { v: 'a' } }
    );
    rerender({ v: 'b' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.state).toBe('saving');
    rerender({ v: 'c' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('c');
    expect(result.current.state).toBe('saved');
  });

  it('a failing save shows error and the next edit retries', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }) => useAutosave(v, save, 800),
      { initialProps: { v: 'a' } }
    );
    rerender({ v: 'b' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.state).toBe('error');
    rerender({ v: 'c' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('c');
    expect(result.current.state).toBe('saved');
  });
});

describe('useAutosave flush and queued retry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flush saves the latest value now and resolves true', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }) => useAutosave(v, save, 800),
      { initialProps: { v: 'a' } }
    );
    rerender({ v: 'b' });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('b');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush waits for an in-flight save, then saves the newer value', async () => {
    let release!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((r) => (release = () => r()))
      )
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }) => useAutosave(v, save, 800),
      { initialProps: { v: 'a' } }
    );
    rerender({ v: 'b' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    rerender({ v: 'c' });
    let ok: boolean | undefined;
    let p!: Promise<boolean>;
    await act(async () => {
      p = result.current.flush();
      release();
      ok = await p;
    });
    expect(ok).toBe(true);
    expect(save).toHaveBeenLastCalledWith('c');
  });

  it('flush resolves false when the save fails', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const { result, rerender } = renderHook(
      ({ v }) => useAutosave(v, save, 800),
      { initialProps: { v: 'a' } }
    );
    rerender({ v: 'b' });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(false);
    expect(result.current.state).toBe('error');
  });

  it('retries an edit made while a save was failing', async () => {
    let fail!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((_, rej) => (fail = () => rej(new Error('x'))))
      )
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }) => useAutosave(v, save, 800),
      { initialProps: { v: 'a' } }
    );
    rerender({ v: 'b' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    rerender({ v: 'c' });
    await act(async () => {
      fail();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe('error');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(save).toHaveBeenLastCalledWith('c');
    expect(result.current.state).toBe('saved');
  });
});

describe('useAutosave revert within the delay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a revert to the saved value sends nothing, and a later edit still saves', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }) => useAutosave(v, save, 800),
      { initialProps: { v: 'a' } }
    );
    rerender({ v: 'x' });
    rerender({ v: 'a' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(save).not.toHaveBeenCalled();
    rerender({ v: 'b' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('b');
    expect(result.current.state).toBe('saved');
  });

  it('flush after a revert resolves true without hanging', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ v }) => useAutosave(v, save, 800),
      { initialProps: { v: 'a' } }
    );
    rerender({ v: 'x' });
    rerender({ v: 'a' });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });
    expect(ok).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
