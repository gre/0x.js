import * as chai from 'chai';
import * as ethUtils from 'ethereumjs-util';
import * as _ from 'lodash';
import * as mocha from 'mocha';
import Web3 = require('web3');
import Web3ProviderEngine = require('web3-provider-engine');
import RpcSubprovider = require('web3-provider-engine/subproviders/rpc');

import {
    ECSignature,
    LedgerSubprovider,
} from '../../src';
import {
    DoneCallback,
    ECSignatureString,
    LedgerCommunicationClient,
    LedgerGetAddressResult,
    LedgerSubproviderErrors,
} from '../../src/types';
import { chaiSetup } from '../chai_setup';
import {reportCallbackErrors} from '../utils/report_callback_errors';

const expect = chai.expect;
const FAKE_ADDRESS = '0x9901c66f2d4b95f7074b553da78084d708beca70';

describe('LedgerSubprovider', () => {
    const networkId: number = 42;
    let ledgerSubprovider: LedgerSubprovider;
    before(async () => {
        const ledgerEthereumClientFactoryAsync = async () => {
            const ledgerEthClient = {
                getAddress_async: async () => {
                    return {
                        address: FAKE_ADDRESS,
                    };
                },
                signPersonalMessage_async: async () => {
                    const ecSignature: ECSignature = {
                        v: 28,
                        r: 'a6cc284bff14b42bdf5e9286730c152be91719d478605ec46b3bebcd0ae49148',
                        s: '0652a1a7b742ceb0213d1e744316e285f41f878d8af0b8e632cbca4c279132d0',
                    };
                    return ecSignature;
                },
                signTransaction_async: async (derivationPath: string, txHex: string) => {
                    const ecSignature: ECSignatureString = {
                        v: '77',
                        r: '88a95ef1378487bc82be558e82c8478baf840c545d5b887536bb1da63673a98b',
                        s: '019f4a4b9a107d1e6752bf7f701e275f28c13791d6e76af895b07373462cefaa',
                    };
                    return ecSignature;
                },
                comm: {
                    close_async: _.noop,
                } as LedgerCommunicationClient,
            };
            return ledgerEthClient;
        };
        ledgerSubprovider = new LedgerSubprovider({
            networkId,
            ledgerEthereumClientFactoryAsync,
        });
    });
    describe('direct method calls', () => {
        describe('success cases', () => {
            it('returns a list of accounts', async () => {
                const accounts = await ledgerSubprovider.getAccountsAsync();
                expect(accounts[0]).to.be.equal(FAKE_ADDRESS);
                expect(accounts.length).to.be.equal(10);
            });
            it('signs a personal message', async () => {
                const data = ethUtils.bufferToHex(ethUtils.toBuffer('hello world'));
                const msgParams = {data};
                const ecSignatureHex = await ledgerSubprovider.signPersonalMessageAsync(msgParams);
                // tslint:disable-next-line:max-line-length
                expect(ecSignatureHex).to.be.equal('0xa6cc284bff14b42bdf5e9286730c152be91719d478605ec46b3bebcd0ae491480652a1a7b742ceb0213d1e744316e285f41f878d8af0b8e632cbca4c279132d001');
            });
        });
        describe('failure cases', () => {
            it('cannot open multiple simultaneous connections to the Ledger device', async () => {
                const data = ethUtils.bufferToHex(ethUtils.toBuffer('hello world'));
                const msgParams = {data};
                try {
                    const result = await Promise.all([
                        ledgerSubprovider.getAccountsAsync(),
                        ledgerSubprovider.signPersonalMessageAsync(msgParams),
                    ]);
                    throw new Error('Multiple simultaneous calls succeeded when they should have failed');
                } catch (err) {
                    expect(err.message).to.be.equal(LedgerSubproviderErrors.MultipleOpenConnectionsDisallowed);
                }
            });
        });
    });
    describe('calls through a provider', () => {
        let provider: Web3ProviderEngine;
        before(() => {
            provider = new Web3ProviderEngine();
            provider.addProvider(ledgerSubprovider);
            const httpProvider = new RpcSubprovider({
                rpcUrl: 'http://localhost:8545',
            });
            provider.addProvider(httpProvider);
            provider.start();
        });
        describe('success cases', () => {
            it('returns a list of accounts', (done: DoneCallback) => {
                const payload = {
                    jsonrpc: '2.0',
                    method: 'eth_accounts',
                    params: [],
                    id: 1,
                };
                const callback = reportCallbackErrors(done)((err: Error, response: Web3.JSONRPCResponsePayload) => {
                    expect(err).to.be.a('null');
                    expect(response.result.length).to.be.equal(10);
                    expect(response.result[0]).to.be.equal(FAKE_ADDRESS);
                    done();
                });
                provider.sendAsync(payload, callback);
            });
            it('signs a personal message', (done: DoneCallback) => {
                const messageHex = ethUtils.bufferToHex(ethUtils.toBuffer('hello world'));
                const payload = {
                    jsonrpc: '2.0',
                    method: 'personal_sign',
                    params: [messageHex, '0x0000000000000000000000000000000000000000'],
                    id: 1,
                };
                const callback = reportCallbackErrors(done)((err: Error, response: Web3.JSONRPCResponsePayload) => {
                    expect(err).to.be.a('null');
                    // tslint:disable-next-line:max-line-length
                    expect(response.result).to.be.equal('0xa6cc284bff14b42bdf5e9286730c152be91719d478605ec46b3bebcd0ae491480652a1a7b742ceb0213d1e744316e285f41f878d8af0b8e632cbca4c279132d001');
                    done();
                });
                provider.sendAsync(payload, callback);
            });
            it('signs a transaction', (done: DoneCallback) => {
                const tx = {
                    to: '0xafa3f8684e54059998bc3a7b0d2b0da075154d66',
                    value: '0x00',
                };
                const payload = {
                    jsonrpc: '2.0',
                    method: 'eth_signTransaction',
                    params: [tx],
                    id: 1,
                };
                const callback = reportCallbackErrors(done)((err: Error, response: Web3.JSONRPCResponsePayload) => {
                    expect(err).to.be.a('null');
                    expect(response.result.raw.length).to.be.equal(206);
                    expect(response.result.raw.substr(0, 2)).to.be.equal('0x');
                    done();
                });
                provider.sendAsync(payload, callback);
            });
        });
        describe('failure cases', () => {
            it('should throw if `from` param missing when calling personal_sign', (done: DoneCallback) => {
                const messageHex = ethUtils.bufferToHex(ethUtils.toBuffer('hello world'));
                const payload = {
                    jsonrpc: '2.0',
                    method: 'personal_sign',
                    params: [messageHex], // Missing from param
                    id: 1,
                };
                const callback = reportCallbackErrors(done)((err: Error, response: Web3.JSONRPCResponsePayload) => {
                    expect(err).to.not.be.a('null');
                    expect(err.message).to.be.equal(LedgerSubproviderErrors.FromAddressMissingOrInvalid);
                    done();
                });
                provider.sendAsync(payload, callback);
            });
            it('should throw if `data` param not hex when calling personal_sign', (done: DoneCallback) => {
                const nonHexMessage = 'hello world';
                const payload = {
                    jsonrpc: '2.0',
                    method: 'personal_sign',
                    params: [nonHexMessage, '0x0000000000000000000000000000000000000000'],
                    id: 1,
                };
                const callback = reportCallbackErrors(done)((err: Error, response: Web3.JSONRPCResponsePayload) => {
                    expect(err).to.not.be.a('null');
                    expect(err.message).to.be.equal(LedgerSubproviderErrors.DataNotValidHexForSignPersonalMessage);
                    done();
                });
                provider.sendAsync(payload, callback);
            });
            it('should throw if `from` param missing when calling eth_sendTransaction', (done: DoneCallback) => {
                const tx = {
                    to: '0xafa3f8684e54059998bc3a7b0d2b0da075154d66',
                    value: '0xde0b6b3a7640000',
                };
                const payload = {
                    jsonrpc: '2.0',
                    method: 'eth_sendTransaction',
                    params: [tx],
                    id: 1,
                };
                const callback = reportCallbackErrors(done)((err: Error, response: Web3.JSONRPCResponsePayload) => {
                    expect(err).to.not.be.a('null');
                    expect(err.message).to.be.equal(LedgerSubproviderErrors.SenderInvalidOrNotSupplied);
                    done();
                });
                provider.sendAsync(payload, callback);
            });
            it('should throw if `from` param invalid address when calling eth_sendTransaction',
               (done: DoneCallback) => {
                const tx = {
                    to: '0xafa3f8684e54059998bc3a7b0d2b0da075154d66',
                    from: '0xIncorrectEthereumAddress',
                    value: '0xde0b6b3a7640000',
                };
                const payload = {
                    jsonrpc: '2.0',
                    method: 'eth_sendTransaction',
                    params: [tx],
                    id: 1,
                };
                const callback = reportCallbackErrors(done)((err: Error, response: Web3.JSONRPCResponsePayload) => {
                    expect(err).to.not.be.a('null');
                    expect(err.message).to.be.equal(LedgerSubproviderErrors.SenderInvalidOrNotSupplied);
                    done();
                });
                provider.sendAsync(payload, callback);
            });
        });
    });
});