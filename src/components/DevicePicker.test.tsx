import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DevicePicker from './DevicePicker';

const ids = { cameraId: '', micId: '', speakerId: '' };

describe('DevicePicker', () => {
  it('asks for access once, releases the stream, then lists devices with their labels', async () => {
    render(<DevicePicker value={ids} onChange={vi.fn()} />);
    const camera = screen.getByRole('combobox', { name: /Camera/ });
    await waitFor(() =>
      expect(within(camera).getByRole('option', { name: 'Front Camera' })).toBeInTheDocument(),
    );
    expect(within(camera).getByRole('option', { name: 'System default' })).toBeInTheDocument();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    const stream = await vi.mocked(navigator.mediaDevices.getUserMedia).mock.results[0].value;
    for (const t of stream.getTracks()) expect(t.stop).toHaveBeenCalled();
  });

  it('reports the chosen device ids through onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DevicePicker value={ids} onChange={onChange} />);
    const camera = screen.getByRole('combobox', { name: /Camera/ });
    await within(camera).findByRole('option', { name: 'External Webcam' });
    await user.selectOptions(camera, 'External Webcam');
    expect(onChange).toHaveBeenCalledWith({ ...ids, cameraId: 'cam-2' });
  });

  it('shows a saved device that is unplugged as the system default', async () => {
    render(<DevicePicker value={{ ...ids, cameraId: 'unplugged' }} onChange={vi.fn()} />);
    const camera = screen.getByRole('combobox', { name: /Camera/ });
    await within(camera).findByRole('option', { name: 'Front Camera' });
    expect(camera).toHaveValue('');
  });

  it('does not open the camera itself when access is already granted', async () => {
    render(<DevicePicker granted value={ids} onChange={vi.fn()} />);
    await within(screen.getByRole('combobox', { name: /Camera/ })).findByRole('option', {
      name: 'Front Camera',
    });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    // The setup page already shows a live preview, so no extra Test buttons for camera and mic.
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument();
  });

  it('starts and stops a camera test with a preview', async () => {
    const user = userEvent.setup();
    render(<DevicePicker value={ids} onChange={vi.fn()} />);
    const row = screen.getByRole('combobox', { name: /Camera/ }).closest('label')!;
    await user.click(within(row).getByRole('button', { name: 'Test' }));
    expect(await screen.findByLabelText('Camera preview')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Stop' }));
    expect(screen.queryByLabelText('Camera preview')).not.toBeInTheDocument();
  });

  it('shows a message when the camera test is blocked', async () => {
    const user = userEvent.setup();
    render(<DevicePicker value={ids} onChange={vi.fn()} />);
    const row = screen.getByRole('combobox', { name: /Camera/ }).closest('label')!;
    await within(row).findByRole('option', { name: 'Front Camera' });
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    await user.click(within(row).getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(row.querySelector('.device-msg')).toHaveTextContent(/.+/));
    expect(within(row).getByRole('button', { name: 'Test' })).toBeInTheDocument();
  });
});
