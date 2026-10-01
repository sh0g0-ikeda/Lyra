import { expect, it } from 'vitest';
import { autofillPanelSuggestionSchema } from '../../../../src/lib/validators/pageAutofill.schema.js';
import { updatePanelBodySchema } from '../../../../src/lib/validators/panel.schema.js';
const line = {entity_id:null,text:'source narration',type:'narration',position:'right'};
it('generated dialogue allows four total entries while manual legacy edits retain twenty',()=>{
 expect(autofillPanelSuggestionSchema.safeParse({order:1,dialogue:Array(4).fill(line)}).success).toBe(true);
 expect(autofillPanelSuggestionSchema.safeParse({order:1,dialogue:Array(5).fill(line)}).success).toBe(false);
 expect(updatePanelBodySchema.safeParse({dialogue:Array(20).fill(line)}).success).toBe(true);
});
