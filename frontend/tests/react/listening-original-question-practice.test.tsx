import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListeningQuestionAudio } from '@/components/listening-question-audio';
import { ListeningSourceSupplement } from '@/components/listening-source-supplement';

const auth = vi.hoisted(() => ({ user: { id: 'learner-a' } }));
vi.mock('@/lib/auth/auth-provider', () => ({ useAuth: () => auth }));
const clip = { item_id:'source-q9', part_id:'p1', variant_id:'original' as const, duration_seconds:8, url:'/original-q9.mp3', context_kind:'question' as const, note_vi:'Đoạn gốc của câu này.' };
const question = { item_id:'source-q9', source_display_number:'9', part_id:'p1', block_id:'b1', prompt:'Listen and choose.', options:[{id:'A',label:'First'},{id:'B',label:'Second'}], fields:[], response_type:'single_choice' as const, reason_vi:'Chưa có đáp án tin cậy.' };
beforeEach(() => { auth.user={id:'learner-a'};localStorage.clear(); vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{}); });
afterEach(()=>{cleanup();vi.restoreAllMocks();});

it('plays and loops before any answer, pauses competing media and clears the loop on part changes',()=>{
 const view=render(<><audio data-testid="whole" src="/whole.mp3" /><ListeningQuestionAudio clip={clip} active /></>);
 const media=view.container.querySelectorAll('audio')[1];
 fireEvent.click(screen.getByRole('button',{name:'Lặp đoạn liên tục'}));expect(media.loop).toBe(true);
 fireEvent.play(media);expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
 fireEvent.play(screen.getByTestId('whole'));expect(media.loop).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Lặp đoạn liên tục'}));
 view.rerender(<><audio data-testid="whole" src="/whole.mp3" /><ListeningQuestionAudio clip={clip} active={false} /></>);
 expect(media.getAttribute('src')).toBeNull();expect(media.loop).toBe(false);
 view.rerender(<><audio data-testid="whole" src="/whole.mp3" /><ListeningQuestionAudio clip={clip} active /></>);
 expect(media.getAttribute('src')).toBe('/original-q9.mp3');
});
it('keeps supplementary drafts local, persists on reload and separates owners and manifests',()=>{
 const view=render(<ListeningSourceSupplement question={question} manifest="m1" clip={clip} active />);
 fireEvent.click(screen.getByRole('radio',{name:'A First'}));expect((screen.getByRole('radio',{name:'A First'}) as HTMLInputElement).checked).toBe(true);
 view.unmount();const again=render(<ListeningSourceSupplement question={question} manifest="m1" clip={clip} active />);
 expect((screen.getByRole('radio',{name:'A First'}) as HTMLInputElement).checked).toBe(true);
 auth.user={id:'learner-b'};again.rerender(<ListeningSourceSupplement question={question} manifest="m1" active />);
 expect((screen.getByRole('radio',{name:'A First'}) as HTMLInputElement).checked).toBe(false);
 expect(screen.queryByRole('button',{name:/Đối chiếu/})).toBeNull();
 expect(screen.getByText(/không gửi chấm hoặc tính điểm/)).toBeTruthy();
});
it('reports a missing clip and exposes retry after a playback failure',()=>{
 const retry=vi.fn();const view=render(<ListeningQuestionAudio clip={clip} reload={retry} />);
 fireEvent.error(view.container.querySelector('audio')!);expect(screen.getByRole('alert')).toBeTruthy();
 vi.mocked(HTMLMediaElement.prototype.load).mockClear();
 fireEvent.click(screen.getByRole('button',{name:'Tải lại đoạn nghe'}));expect(retry).toHaveBeenCalledOnce();
 expect(HTMLMediaElement.prototype.load).toHaveBeenCalledOnce();
 expect(screen.queryByRole('alert')).toBeNull();
});
