/**
 * Sami React Runtime Shim
 * Delegates React hooks and createElement directly to the host application's React instance
 * (window.__SamiReact and window.__SamiJsx from the main app bundle).
 *
 * This prevents duplicate React instances in memory, eliminating:
 * 1. "Invalid hook call. Hooks can only be called inside of the body of a function component."
 * 2. "TypeError: Cannot read properties of null (reading 'useRef')"
 */

import type {
  useState as useStateType,
  useEffect as useEffectType,
  useRef as useRefType,
  useCallback as useCallbackType,
  useMemo as useMemoType,
  useReducer as useReducerType,
  useContext as useContextType,
  useId as useIdType,
  useLayoutEffect as useLayoutEffectType,
  createContext as createContextType,
  forwardRef as forwardRefType,
  ComponentType,
  ReactNode,
} from 'react';

function getHostReact(): any {
  if (typeof window !== 'undefined') {
    const w = window as any;
    if (w.__SamiReact) return w.__SamiReact;
    if (w.React) return w.React;
  }
  return null;
}

export const useState = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.useState) {
    throw new Error('[SamiUpdater] Host React is not initialized yet. Ensure main bundle is loaded.');
  }
  return r.useState(...args);
}) as typeof useStateType;

export const useEffect = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.useEffect) {
    throw new Error('[SamiUpdater] Host React is not initialized yet.');
  }
  return r.useEffect(...args);
}) as typeof useEffectType;

export const useRef = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.useRef) {
    throw new Error('[SamiUpdater] Host React is not initialized yet.');
  }
  return r.useRef(...args);
}) as typeof useRefType;

export const useCallback = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.useCallback) {
    throw new Error('[SamiUpdater] Host React is not initialized yet.');
  }
  return r.useCallback(...args);
}) as typeof useCallbackType;

export const useMemo = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.useMemo) {
    throw new Error('[SamiUpdater] Host React is not initialized yet.');
  }
  return r.useMemo(...args);
}) as typeof useMemoType;

export const useReducer = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.useReducer) {
    throw new Error('[SamiUpdater] Host React is not initialized yet.');
  }
  return r.useReducer(...args);
}) as typeof useReducerType;

export const useContext = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.useContext) {
    throw new Error('[SamiUpdater] Host React is not initialized yet.');
  }
  return r.useContext(...args);
}) as typeof useContextType;

export const useId = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.useId) {
    throw new Error('[SamiUpdater] Host React is not initialized yet.');
  }
  return r.useId(...args);
}) as typeof useIdType;

export const useLayoutEffect = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.useLayoutEffect) {
    throw new Error('[SamiUpdater] Host React is not initialized yet.');
  }
  return r.useLayoutEffect(...args);
}) as typeof useLayoutEffectType;

export const createContext = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.createContext) {
    throw new Error('[SamiUpdater] Host React is not initialized yet.');
  }
  return r.createContext(...args);
}) as typeof createContextType;

export const forwardRef = ((...args: any[]) => {
  const r = getHostReact();
  if (!r?.forwardRef) {
    throw new Error('[SamiUpdater] Host React is not initialized yet.');
  }
  return r.forwardRef(...args);
}) as typeof forwardRefType;

export const createElement = (type: any, props: any, ...children: any[]) => {
  const r = getHostReact();
  if (r?.createElement) {
    return r.createElement(type, props, ...children);
  }
  // Fallback to React 19 jsx runtime if createElement isn't available
  const w = typeof window !== 'undefined' ? (window as any) : null;
  if (w?.__SamiJsx?.jsx) {
    const finalProps = { ...props };
    if (children.length === 1) {
      finalProps.children = children[0];
    } else if (children.length > 1) {
      finalProps.children = children;
    }
    return w.__SamiJsx.jsx(type, finalProps);
  }
  throw new Error('[SamiUpdater] Neither createElement nor jsx runtime available on host.');
};

export const Fragment = (typeof window !== 'undefined' && ((window as any).__SamiReact?.Fragment || (window as any).React?.Fragment)) || Symbol.for('react.fragment');

const ReactProxy: any = new Proxy(
  {
    createElement,
    Fragment,
    useState,
    useEffect,
    useRef,
    useCallback,
    useMemo,
    useReducer,
    useContext,
    useId,
    useLayoutEffect,
    createContext,
    forwardRef,
  },
  {
    get(target, prop) {
      if (prop in target) {
        return (target as any)[prop];
      }
      const host = getHostReact();
      if (host && prop in host) {
        return host[prop];
      }
      return undefined;
    },
  }
);

export default ReactProxy;
