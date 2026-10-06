import {describe,expect,it,vi} from 'vitest';
import {hasNativeCognitoEmail} from '../../../../src/infrastructure/auth/CognitoGooglePreSignUpGuard.js';
describe('Cognito collision lookup',()=>{
 it('finds mixed-case native emails on later pages using the documented case-insensitive exact email filter',async()=>{const send=vi.fn().mockResolvedValueOnce({Users:[],PaginationToken:'page2'}).mockResolvedValueOnce({Users:[{UserStatus:'CONFIRMED',Attributes:[{Name:'email',Value:'Owner@Example.COM'}]}]});expect(await hasNativeCognitoEmail({send},'pool','owner@example.com')).toBe(true);expect(send.mock.calls[0][0].input.Filter).toBe('email = "owner@example.com"');expect(send.mock.calls[1][0].input.PaginationToken).toBe('page2');});
 it('never declares unique when the lookup bound is exhausted',async()=>{const send=vi.fn(async()=>({$metadata:{},Users:[],PaginationToken:'more'}));await expect(hasNativeCognitoEmail({send},'pool','owner@example.com')).rejects.toThrow('Identity lookup is unavailable');expect(send).toHaveBeenCalledTimes(10);});
 it('allows a genuinely absent native email after a complete scan',async()=>{const send=vi.fn(async()=>({$metadata:{},Users:[{UserStatus:'EXTERNAL_PROVIDER' as const,Attributes:[{Name:'email',Value:'owner@example.com'}]}]}));expect(await hasNativeCognitoEmail({send},'pool','owner@example.com')).toBe(false);});
});
