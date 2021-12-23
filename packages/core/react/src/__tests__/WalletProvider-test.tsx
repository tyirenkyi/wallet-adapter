/**
 * @jest-environment jsdom
 */

'use strict';

import 'jest-localstorage-mock';
import { render, unmountComponentAtNode } from 'react-dom';
import React, { createRef, forwardRef, useImperativeHandle } from 'react';
import { act } from 'react-dom/test-utils';
import { WalletProvider, WalletProviderProps } from '../WalletProvider';
import { BaseWalletAdapter, Wallet, WalletError, WalletName, WalletNotReadyError } from '@solana/wallet-adapter-base';
import { PublicKey } from '@solana/web3.js';
import { useWallet, WalletContextState } from '../useWallet';

type TestRefType = {
    getWalletContextState(): WalletContextState;
};

const TestComponent = forwardRef(function TestComponentImpl(props, ref) {
    const wallet = useWallet();
    useImperativeHandle(
        ref,
        () => ({
            getWalletContextState() {
                return wallet;
            },
        }),
        [wallet]
    );
    return null;
});

describe('WalletProvider', () => {
    let container: HTMLDivElement | null;
    let ref: React.RefObject<TestRefType>;
    let fooWalletAdapter: MockWalletAdapter;
    let barWalletAdapter: MockWalletAdapter;
    let bazWalletAdapter: MockWalletAdapter;
    let wallets: Wallet[];

    function renderTest(props: Pick<WalletProviderProps, Exclude<keyof WalletProviderProps, 'children' | 'wallets'>>) {
        act(() => {
            render(
                <WalletProvider {...props} wallets={wallets}>
                    <TestComponent ref={ref} />
                </WalletProvider>,
                container
            );
        });
    }

    abstract class MockWalletAdapter extends BaseWalletAdapter {
        connectionPromise: null | Promise<void> = null;
        disconnectionPromise: null | Promise<void> = null;
        readyPromise: null | Promise<void> = null;
        connectedValue = false;
        get connected() {
            return this.connectedValue;
        }
        connecting = false;
        ready = jest.fn(async () => {
            if (this.readyPromise) {
                await this.readyPromise;
            }
            return true;
        });
        connect = jest.fn(async () => {
            this.connecting = true;
            if (this.connectionPromise) {
                await this.connectionPromise;
            }
            this.connecting = false;
            this.connectedValue = true;
            this.emit('connect');
        });
        disconnect = jest.fn(async () => {
            this.connecting = false;
            if (this.disconnectionPromise) {
                await this.disconnectionPromise;
            }
            this.connectedValue = false;
            this.emit('disconnect');
        });
        sendTransaction = jest.fn();
    }
    class FooWalletAdapter extends MockWalletAdapter {
        publicKey = new PublicKey('Foo11111111111111111111111111111111111111111');
    }
    class BarWalletAdapter extends MockWalletAdapter {
        publicKey = new PublicKey('Bar11111111111111111111111111111111111111111');
    }
    class BazWalletAdapter extends MockWalletAdapter {
        publicKey = new PublicKey('Baz11111111111111111111111111111111111111111');
    }

    beforeEach(() => {
        localStorage.clear();
        jest.resetAllMocks();
        container = document.createElement('div');
        document.body.appendChild(container);
        ref = createRef();
        fooWalletAdapter = new FooWalletAdapter();
        barWalletAdapter = new BarWalletAdapter();
        bazWalletAdapter = new BazWalletAdapter();
        wallets = [
            {
                adapter: fooWalletAdapter,
                icon: 'foo.png',
                name: 'FooWallet' as WalletName,
                url: 'https://foowallet.com',
            },
            {
                adapter: barWalletAdapter,
                icon: 'bar.png',
                name: 'BarWallet' as WalletName,
                url: 'https://barwallet.com',
            },
            {
                adapter: bazWalletAdapter,
                icon: 'baz.png',
                name: 'BazWallet' as WalletName,
                url: 'https://bazwallet.com',
            },
        ];
    });
    afterEach(() => {
        if (container) {
            unmountComponentAtNode(container);
            container.remove();
            container = null;
        }
    });
    describe('given a selected wallet', () => {
        let makeReady: () => void;
        beforeEach(async () => {
            fooWalletAdapter.readyPromise = new Promise((resolve) => {
                makeReady = resolve;
            });
            renderTest({});
            await act(async () => {
                ref.current?.getWalletContextState().select('FooWallet' as WalletName);
                await Promise.resolve(); // Flush all promises in effects after calling `select()`.
            });
            expect(ref.current?.getWalletContextState().ready).toBe(false);
        });
        describe('that then becomes ready', () => {
            beforeEach(() => {
                act(() => {
                    makeReady();
                });
            });
            it('sets `ready` to true', () => {
                expect(ref.current?.getWalletContextState().ready).toBe(true);
            });
        });
        describe('when the wallet disconnects of its own accord', () => {
            beforeEach(() => {
                act(() => {
                    fooWalletAdapter.disconnect();
                });
            });
            it('should clear the stored wallet name', () => {
                expect(localStorage.removeItem).toHaveBeenCalled();
            });
            it('updates state tracking variables appropriately', () => {
                expect(ref.current?.getWalletContextState()).toMatchObject({
                    adapter: null,
                    connected: false,
                    connecting: false,
                    publicKey: null,
                    ready: false,
                });
            });
        });
        describe('when the wallet disconnects as a consequence of the window unloading', () => {
            beforeEach(() => {
                act(() => {
                    window.dispatchEvent(new Event('beforeunload'));
                    fooWalletAdapter.disconnect();
                });
            });
            it('should not clear the stored wallet name', () => {
                expect(localStorage.removeItem).not.toHaveBeenCalled();
            });
        });
    });
    describe('when there exists no stored wallet name', () => {
        beforeEach(() => {
            (localStorage.getItem as jest.Mock).mockReturnValue(null);
        });
        it('loads no adapter into state', () => {
            renderTest({});
            expect(ref.current?.getWalletContextState().adapter).toBeNull();
        });
        it('loads no public key into state', () => {
            renderTest({});
            expect(ref.current?.getWalletContextState().publicKey).toBeNull();
        });
    });
    describe('when there exists a stored wallet name', () => {
        beforeEach(() => {
            (localStorage.getItem as jest.Mock).mockReturnValue(JSON.stringify('FooWallet'));
        });
        it('loads the corresponding adapter into state', () => {
            renderTest({});
            expect(ref.current?.getWalletContextState().adapter).toBeInstanceOf(FooWalletAdapter);
        });
        it('loads the corresponding public key into state', () => {
            renderTest({});
            expect(ref.current?.getWalletContextState().publicKey).toBe(fooWalletAdapter.publicKey);
        });
        it('sets state tracking variables to defaults', () => {
            renderTest({});
            expect(ref.current?.getWalletContextState()).toMatchObject({
                connected: false,
                connecting: false,
            });
        });
        describe('and auto connect is disabled', () => {
            const props = { autoConnect: false };
            beforeEach(() => {
                renderTest(props);
            });
            it('`autoConnect` is `false` on state', () => {
                expect(ref.current?.getWalletContextState().autoConnect).toBe(false);
            });
            it('does not call `connect` on the adapter', () => {
                expect(fooWalletAdapter.connect).not.toHaveBeenCalled();
            });
        });
        describe('and auto connect is enabled', () => {
            const props = { autoConnect: true };
            beforeEach(() => {
                renderTest(props);
            });
            it('`autoConnect` is `true` on state', () => {
                expect(ref.current?.getWalletContextState().autoConnect).toBe(true);
            });
            describe('before the adapter is ready', () => {
                it('does not call `connect` on the adapter', () => {
                    expect(fooWalletAdapter.connect).not.toHaveBeenCalled();
                });
            });
            describe('once the adapter becomes ready', () => {
                beforeEach(() => {
                    act(() => {
                        fooWalletAdapter.ready();
                    });
                });
                it('calls `connect` on the adapter', () => {
                    expect(fooWalletAdapter.connect).toHaveBeenCalledTimes(1);
                });
            });
        });
    });
    describe('custom error handler', () => {
        const errorToEmit = new WalletError();
        let handleError: (error: WalletError) => void;
        beforeEach(async () => {
            handleError = jest.fn();
            renderTest({ onError: handleError });
            await act(async () => {
                ref.current?.getWalletContextState().select('FooWallet' as WalletName);
                await Promise.resolve(); // Flush all promises in effects after calling `select()`.
            });
        });
        it('gets called in response to adapter errors', () => {
            act(() => {
                fooWalletAdapter.emit('error', errorToEmit);
            });
            expect(handleError).toBeCalledWith(errorToEmit);
        });
        it('does not get called if the window is unloading', () => {
            const errorToEmit = new WalletError();
            act(() => {
                window.dispatchEvent(new Event('beforeunload'));
                fooWalletAdapter.emit('error', errorToEmit);
            });
            expect(handleError).not.toBeCalled();
        });
    });
    describe('connect()', () => {
        describe('given a wallet that is not ready', () => {
            beforeEach(async () => {
                window.open = jest.fn();
                renderTest({});
                act(() => {
                    ref.current?.getWalletContextState().select('FooWallet' as WalletName);
                });
                expect(ref.current?.getWalletContextState().ready).toBe(false);
                act(() => {
                    expect(ref.current?.getWalletContextState().connect).rejects.toThrow();
                });
            });
            it('clears out the state', () => {
                expect(ref.current?.getWalletContextState()).toMatchObject({
                    adapter: null,
                    connected: false,
                    connecting: false,
                    publicKey: null,
                });
            });
            it("opens the wallet's URL in a new window", () => {
                expect(window.open).toBeCalledWith('https://foowallet.com', '_blank');
            });
            it('throws a `WalletNotReady` error', () => {
                act(() => {
                    expect(ref.current?.getWalletContextState().connect()).rejects.toThrow(new WalletNotReadyError());
                });
            });
        });
        describe('given a wallet that is ready', () => {
            let commitConnection: () => void;
            beforeEach(async () => {
                renderTest({});
                await act(async () => {
                    ref.current?.getWalletContextState().select('FooWallet' as WalletName);
                    await Promise.resolve(); // Flush all promises in effects after calling `select()`.
                });
                fooWalletAdapter.connectionPromise = new Promise<void>((resolve) => {
                    commitConnection = resolve;
                });
                act(() => {
                    ref.current?.getWalletContextState().connect();
                });
            });
            it('calls connect on the adapter', () => {
                expect(fooWalletAdapter.connect).toHaveBeenCalled();
            });
            it('updates state tracking variables appropriately', () => {
                expect(ref.current?.getWalletContextState()).toMatchObject({
                    connected: false,
                    connecting: true,
                });
            });
            describe('once connected', () => {
                beforeEach(() => {
                    act(() => {
                        commitConnection();
                    });
                });
                it('updates state tracking variables appropriately', () => {
                    expect(ref.current?.getWalletContextState()).toMatchObject({
                        connected: true,
                        connecting: false,
                    });
                });
            });
        });
    });
    describe('disconnect()', () => {
        describe('when there is already a wallet connected', () => {
            let commitDisconnection: () => void;
            beforeEach(async () => {
                window.open = jest.fn();
                renderTest({});
                await act(async () => {
                    ref.current?.getWalletContextState().select('FooWallet' as WalletName);
                    await Promise.resolve(); // Flush all promises in effects after calling `select()`.
                });
                act(() => {
                    ref.current?.getWalletContextState().connect();
                });
                fooWalletAdapter.disconnectionPromise = new Promise<void>((resolve) => {
                    commitDisconnection = resolve;
                });
                act(() => {
                    ref.current?.getWalletContextState().disconnect();
                });
            });
            it('updates state tracking variables appropriately', () => {
                expect(ref.current?.getWalletContextState()).toMatchObject({
                    connected: true,
                });
            });
            describe('once disconnected', () => {
                beforeEach(() => {
                    act(() => {
                        commitDisconnection();
                    });
                });
                it('should clear the stored wallet name', () => {
                    expect(localStorage.removeItem).toHaveBeenCalled();
                });
                it('clears out the state', () => {
                    expect(ref.current?.getWalletContextState()).toMatchObject({
                        adapter: null,
                        connected: false,
                        connecting: false,
                        publicKey: null,
                    });
                });
            });
        });
    });
    describe('select()', () => {
        describe('when there is no wallet connected', () => {
            describe('and you select a wallet', () => {
                beforeEach(async () => {
                    renderTest({});
                    await act(async () => {
                        ref.current?.getWalletContextState().select('FooWallet' as WalletName);
                        await Promise.resolve(); // Flush all promises in effects after calling `select()`.
                    });
                });
                it('sets the state tracking variables', () => {
                    expect(ref.current?.getWalletContextState()).toMatchObject({
                        adapter: fooWalletAdapter,
                        connected: false,
                        connecting: false,
                        publicKey: fooWalletAdapter.publicKey,
                    });
                });
            });
        });
        describe('when there is already a wallet selected', () => {
            let commitFooWalletDisconnection: () => void;
            beforeEach(async () => {
                fooWalletAdapter.disconnectionPromise = new Promise<void>((resolve) => {
                    commitFooWalletDisconnection = resolve;
                });
                renderTest({});
                await act(async () => {
                    ref.current?.getWalletContextState().select('FooWallet' as WalletName);
                    await Promise.resolve(); // Flush all promises in effects after calling `select()`.
                });
            });
            describe('and you select a different wallet', () => {
                beforeEach(async () => {
                    await act(async () => {
                        ref.current?.getWalletContextState().select('BarWallet' as WalletName);
                        await Promise.resolve(); // Flush all promises in effects after calling `select()`.
                    });
                });
                it('should disconnect the old wallet', () => {
                    expect(fooWalletAdapter.disconnect).toHaveBeenCalled();
                });
                it('the adapter of the new wallet should be set in state', () => {
                    expect(ref.current?.getWalletContextState().adapter).toBe(barWalletAdapter);
                });
                /**
                 * Regression test: a race condition in the wallet name setter could result in the
                 * wallet reverting back to an old value, depending on the cadence of the previous
                 * wallets' disconnect operation.
                 */
                describe('then change your mind before the first one has disconnected', () => {
                    beforeEach(async () => {
                        await act(async () => {
                            ref.current?.getWalletContextState().select('BazWallet' as WalletName);
                            await Promise.resolve(); // Flush all promises in effects after calling `select()`.
                        });
                        act(() => {
                            commitFooWalletDisconnection();
                        });
                    });
                    it('the wallet you selected last should be set in state', () => {
                        expect(ref.current?.getWalletContextState().adapter).toBe(bazWalletAdapter);
                    });
                });
            });
        });
    });
});