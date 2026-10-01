import {expect,it,vi} from 'vitest';
import {renderQuotedLayoutGuide} from '../../../../src/services/generation/QuotedGenerationInputs.js';
import {resolvePageGenerationLayoutControl} from '../../../../src/services/page/PageGenerationLayoutControl.js';
it('old quote omission retains only its old unnumbered custom guide',()=>{
 const renderer={render:vi.fn().mockReturnValue({imageData:Buffer.from('guide'),mimeType:'image/png'})};
 const config={type:'custom',frame_definitions:[{legacy:'shape'}]};
 renderQuotedLayoutGuide(undefined,config,renderer);expect(renderer.render).toHaveBeenCalledWith(config.frame_definitions);
 renderer.render.mockClear();renderQuotedLayoutGuide(null,config,renderer);expect(renderer.render).not.toHaveBeenCalled();
 const control=resolvePageGenerationLayoutControl({type:'template',template_id:'splash_1'},1)!;
 renderQuotedLayoutGuide(control,config,renderer);expect(renderer.render).toHaveBeenCalledWith(control.frames,{numberFrames:true});
});
