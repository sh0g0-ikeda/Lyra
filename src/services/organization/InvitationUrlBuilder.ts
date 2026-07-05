export class InvitationUrlBuilder {
  public constructor(private readonly appPublicUrl: string) {}

  public buildInvitationUrl(token: string): string {
    const baseUrl = this.appPublicUrl.replace(/\/+$/, '');
    return `${baseUrl}/invite/${encodeURIComponent(token)}`;
  }
}
