import fetch from 'node-fetch';

const SOLSCAN_API_TOKEN = process.env.SOLSCAN_API_TOKEN;

class SolscanAPI {
    constructor() {
        this.baseUrl = 'https://pro-api.solscan.io/v2.0';
        this.requestOptions = {
            method: 'get',
            headers: {
                'token': SOLSCAN_API_TOKEN
            }
        };
    }

    async getAccountTransfers(address, options = {}) {
        const queryParams = new URLSearchParams({
            address,
            page: options.page || 1,
            page_size: options.pageSize || 10,
            sort_by: 'block_time',
            sort_order: 'desc',
            ...(options.token && { token: options.token }),
            ...(options.flow && { flow: options.flow })
        });

        const response = await fetch(`${this.baseUrl}/account/transfer?${queryParams}`, this.requestOptions);
        if (!response.ok) {
            throw new Error(`Solscan API error: ${response.statusText}`);
        }
        return await response.json();
    }

    async getAccountDefiActivities(address, options = {}) {
        const queryParams = new URLSearchParams({
            address,
            page: options.page || 1,
            page_size: options.pageSize || 10,
            sort_by: 'block_time',
            sort_order: 'desc'
        });

        const response = await fetch(`${this.baseUrl}/account/defi/activities?${queryParams}`, this.requestOptions);
        if (!response.ok) {
            throw new Error(`Solscan API error: ${response.statusText}`);
        }
        return await response.json();
    }

    async getTrendingTokens(limit = 10) {
        const response = await fetch(`${this.baseUrl}/token/trending?limit=${limit}`, this.requestOptions);
        if (!response.ok) {
            throw new Error(`Solscan API error: ${response.statusText}`);
        }
        return await response.json();
    }

    async getTokenList(options = {}) {
        const queryParams = new URLSearchParams({
            page: options.page || 1,
            page_size: options.pageSize || 10,
            ...(options.sortBy && { sort_by: options.sortBy }),
            ...(options.sortOrder && { sort_order: options.sortOrder })
        });

        const response = await fetch(`${this.baseUrl}/token/list?${queryParams}`, this.requestOptions);
        if (!response.ok) {
            throw new Error(`Solscan API error: ${response.statusText}`);
        }
        return await response.json();
    }
}

export default SolscanAPI;
