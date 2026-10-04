export type SubscriptionStatus = {
    installed: boolean;
    authenticated: boolean;
    authenticationUnknown?: boolean;
    models: Array<{ id: string; name: string }>;
    error?: string;
};
