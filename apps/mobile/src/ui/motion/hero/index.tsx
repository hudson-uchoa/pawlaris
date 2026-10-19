import {
  createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState,
  type ReactElement,
} from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation, measure, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { duration, spring } from '../tokens';
import { useAnimationActive } from '../useAnimationActive';
import { useReduceMotion } from '../useReduceMotion';
import { measureFrames } from './geometry';
import { Overlay } from './Overlay';
import type {
  Direction, Endpoint, EndpointRole, Frames, HeroContent, HeroElement, HeroProviderProps, HeroSource, HeroTarget,
} from './types';

export type { HeroContent, HeroElement, HeroProviderProps, HeroSource, HeroTarget } from './types';

type Session = {
  id: string;
  run: number;
  direction: Direction;
  content: HeroContent | null;
  base: Frames | null;
  from: Frames | null;
  to: Frames | null;
  outgoing: Endpoint | null;
  incoming: Endpoint | null;
  navigate(): void;
};
type SavedSource = { id: string; content: HeroContent; base: Frames | null };
type HeroContextValue = {
  id: string | null;
  register(id: string, role: EndpointRole, endpoint: Endpoint): () => void;
  layout(id: string, part: keyof Frames): void;
  start(id: string, content: HeroContent, navigate: () => void): void;
  back(id: string, navigate: () => void): void;
  blur(id: string): void;
};
const HeroContext = createContext<HeroContextValue | null>(null);

function restore(endpoint: Endpoint | null) {
  'worklet';
  if (endpoint === null) return;
  cancelAnimation(endpoint.opacity);
  cancelAnimation(endpoint.bodyOpacity);
  endpoint.opacity.set(1);
  endpoint.bodyOpacity.set(1);
}

export function HeroProvider({ children, active: focused = true }: HeroProviderProps): ReactElement {
  const active = useAnimationActive(focused);
  const reduced = useReduceMotion();
  const { width, height } = useWindowDimensions();
  const host = useAnimatedRef<View>();
  const sources = useRef(new Map<string, Endpoint>());
  const targets = useRef(new Map<string, Endpoint>());
  const saved = useRef<SavedSource | null>(null);
  const current = useRef<Session | null>(null);
  const sequence = useRef(0);
  const preparing = useRef(false);
  const mountedRun = useRef(0);
  const targetLayout = useRef({ avatar: false, name: false });
  const [session, setSession] = useState<Session | null>(null);
  const generation = useSharedValue(0);
  const motionActive = useSharedValue(active);
  const reduceMotion = useSharedValue(reduced);
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);
  const destination = useSharedValue<Frames | null>(null);
  const origin = useSharedValue({ x: 0, y: 0 });
  const running = useSharedValue(false);
  const settled = useSharedValue(true);

  const complete = useCallback((run: number) => {
    if (sequence.current !== run) return;
    if (current.current?.direction === 'back') saved.current = null;
    current.current = null;
    preparing.current = false;
    setSession(null);
  }, []);

  const abort = useCallback(() => {
    const previous = current.current;
    const outgoing = previous?.outgoing ?? null;
    const incoming = previous?.incoming ?? null;
    const run = ++sequence.current;
    preparing.current = false;
    current.current = null;
    scheduleOnUI(() => {
      'worklet';
      generation.set(run);
      running.set(false);
      settled.set(true);
      cancelAnimation(progress);
      cancelAnimation(opacity);
      opacity.set(0);
      restore(outgoing);
      restore(incoming);
      scheduleOnRN(complete, run);
    });
  }, [generation, running, settled, progress, opacity, complete]);

  const animate = useCallback((transition: Session, incoming: Endpoint | null, to: Frames | null) => {
    const { run, from, base, outgoing } = transition;
    scheduleOnUI(() => {
      'worklet';
      if (generation.get() !== run || running.get() || settled.get()) return;
      running.set(true);
      destination.set(to);
      const finish = (finished: boolean | undefined) => {
        'worklet';
        if (!finished || generation.get() !== run) return;
        running.set(false);
        settled.set(true);
        restore(outgoing);
        restore(incoming);
        opacity.set(0);
        scheduleOnRN(complete, run);
      };
      if (!motionActive.get()) {
        finish(true);
        return;
      }
      const fallback = reduceMotion.get() || from === null || to === null || base === null;
      if (fallback) {
        // Q-45: every fallback shares this timing-only crossfade.
        if (incoming !== null) {
          incoming.opacity.set(withTiming(1, { duration: duration.reducedFade }));
          incoming.bodyOpacity.set(withTiming(1, { duration: duration.reducedFade }));
        }
        if (outgoing !== null) {
          if (from === null || base === null) outgoing.opacity.set(withTiming(0, { duration: duration.reducedFade }));
          outgoing.bodyOpacity.set(withTiming(0, { duration: duration.reducedFade }));
        }
        opacity.set(withTiming(0, { duration: duration.reducedFade }, finish));
      } else {
        if (incoming !== null) incoming.bodyOpacity.set(withTiming(1, { duration: duration.base }));
        progress.set(withSpring(1, spring.snappy, finish));
      }
    });
  }, [generation, running, settled, destination, motionActive, reduceMotion, opacity, progress, complete]);

  const show = useCallback((transition: Session) => {
    if (sequence.current !== transition.run) return;
    current.current = transition;
    preparing.current = false;
    if (transition.direction === 'forward' && transition.content !== null) {
      saved.current = { id: transition.id, content: transition.content, base: transition.base };
    }
    // The registry may attach a newly mounted target to the current run.
    // Keep that mutable bookkeeping separate from the render snapshot.
    setSession({ ...transition });
  }, []);

  const begin = useCallback((id: string, direction: Direction, content: HeroContent | null, navigate: () => void) => {
    if (preparing.current || current.current !== null) return;
    preparing.current = true;
    const run = ++sequence.current;
    targetLayout.current = { avatar: false, name: false };
    const outgoing = (direction === 'forward' ? sources : targets).current.get(id) ?? null;
    const incoming = (direction === 'forward' ? targets : sources).current.get(id) ?? null;
    const remembered = saved.current?.id === id ? saved.current : null;
    const overlayContent = direction === 'forward' ? content : remembered?.content ?? null;
    const original = remembered?.base ?? null;
    // React content and navigation stay on RN; only native refs and shared
    // values cross to the UI runtime for measurement and animation.
    const measured = (from: Frames | null, to: Frames | null) => {
      show({ id, run, direction, content: overlayContent, base: direction === 'forward' ? from : original,
        from, to, outgoing, incoming, navigate });
    };
    scheduleOnUI(() => {
      'worklet';
      generation.set(run);
      running.set(false);
      settled.set(false);
      cancelAnimation(progress);
      cancelAnimation(opacity);
      progress.set(0);
      opacity.set(1);
      destination.set(null);
      const from = measureFrames(outgoing, width, height);
      const to = direction === 'back' ? measureFrames(incoming, width, height) : null;
      scheduleOnRN(measured, from, to);
    });
  }, [show, generation, running, settled, progress, opacity, destination, width, height]);

  const start = useCallback((id: string, content: HeroContent, navigate: () => void) => {
    begin(id, 'forward', content, navigate);
  }, [begin]);
  const back = useCallback((id: string, navigate: () => void) => {
    begin(id, 'back', null, navigate);
  }, [begin]);

  // Mount the copies first, then hide the originals, then change the route.
  useLayoutEffect(() => {
    if (session === null || mountedRun.current === session.run) return;
    mountedRun.current = session.run;
    const { run, outgoing, incoming, from, base, navigate, direction, to } = session;
    const navigated = () => {
      if (sequence.current !== run) return;
      navigate();
      if (direction === 'back') animate(session, incoming, to);
    };
    scheduleOnUI(() => {
      'worklet';
      if (generation.get() !== run) return;
      if (outgoing !== null && from !== null && base !== null) outgoing.opacity.set(0);
      if (incoming !== null) {
        incoming.opacity.set(0);
        incoming.bodyOpacity.set(0);
      }
      scheduleOnRN(navigated);
    });
  }, [session, animate, generation]);

  const register = useCallback((id: string, role: EndpointRole, endpoint: Endpoint) => {
    const registry = role === 'source' ? sources.current : targets.current;
    registry.set(id, endpoint);
    const transition = current.current;
    const destinationRole = transition?.direction === 'forward' ? 'target' : 'source';
    if (transition?.id === id && role === destinationRole) transition.incoming = endpoint;
    return () => {
      if (registry.get(id) !== endpoint) return;
      registry.delete(id);
      const transition = current.current;
      const destinationRole = transition?.direction === 'forward' ? 'target' : 'source';
      if (transition?.id === id && role === destinationRole) abort();
      if (role === 'target' && transition?.direction !== 'back' && saved.current?.id === id) saved.current = null;
    };
  }, [abort]);

  const layout = useCallback((id: string, part: keyof Frames) => {
    const transition = current.current;
    if (transition === null || transition.id !== id || transition.direction !== 'forward') return;
    targetLayout.current[part] = true;
    if (!targetLayout.current.avatar || !targetLayout.current.name) return;
    const incoming = targets.current.get(id) ?? null;
    transition.incoming = incoming;
    const { run } = transition;
    const measured = (to: Frames | null) => {
      if (sequence.current === run) animate(transition, incoming, to);
    };
    scheduleOnUI(() => {
      'worklet';
      if (generation.get() === run) scheduleOnRN(measured, measureFrames(incoming, width, height));
    });
  }, [animate, generation, width, height]);

  const blur = useCallback((id: string) => {
    if (current.current?.id === id && current.current.direction === 'forward') abort();
  }, [abort]);

  useLayoutEffect(() => {
    scheduleOnUI(() => {
      'worklet';
      motionActive.set(active);
      reduceMotion.set(reduced);
    });
    if (!active) abort();
    else if (current.current !== null && reduced) {
      const transition = current.current;
      const incoming = transition.incoming;
      scheduleOnUI(() => { 'worklet'; cancelAnimation(progress); running.set(false); });
      animate(transition, incoming, null);
    }
  }, [active, reduced, abort, animate, motionActive, reduceMotion, progress, running]);

  useLayoutEffect(() => () => { abort(); }, [abort]);
  const context = useMemo(() => ({ id: session?.id ?? null, register, layout, start, back, blur }),
    [session?.id, register, layout, start, back, blur]);
  const updateOrigin = useCallback(() => {
    scheduleOnUI(() => {
      'worklet';
      const frame = measure(host);
      if (frame !== null) origin.set({ x: frame.pageX, y: frame.pageY });
    });
  }, [host, origin]);
  return <HeroContext.Provider value={context}>
    <Animated.View ref={host} collapsable={false} onLayout={updateOrigin} style={{ flex: 1 }}>
      {children}
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1 }]}>
        {session !== null && session.from !== null && session.base !== null && session.content !== null
          && <Overlay content={session.content} base={session.base} from={session.from}
            progress={progress} destination={destination} opacity={opacity} origin={origin} />}
      </View>
    </Animated.View>
  </HeroContext.Provider>;
}

function useBinding(id: string, role: EndpointRole) {
  const context = useContext(HeroContext);
  if (context === null) throw new Error('Hero hooks require HeroProvider');
  const avatar = useAnimatedRef<View>();
  const name = useAnimatedRef<View>();
  const opacity = useSharedValue(role === 'target' && context.id === id ? 0 : 1);
  const bodyOpacity = useSharedValue(role === 'target' && context.id === id ? 0 : 1);
  const endpoint = useMemo(() => ({ avatar, name, opacity, bodyOpacity }), [avatar, name, opacity, bodyOpacity]);
  const { register, layout } = context;
  useLayoutEffect(() => register(id, role, endpoint), [register, id, role, endpoint]);
  const avatarStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const nameStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: bodyOpacity.get() }));
  const avatarLayout = useCallback(() => { if (role === 'target') layout(id, 'avatar'); }, [id, role, layout]);
  const nameLayout = useCallback(() => { if (role === 'target') layout(id, 'name'); }, [id, role, layout]);
  return { context, contentStyle,
    avatar: { ref: avatar, collapsable: false, style: avatarStyle, onLayout: avatarLayout } satisfies HeroElement,
    name: { ref: name, collapsable: false, style: nameStyle, onLayout: nameLayout } satisfies HeroElement };
}

export function useHeroSource(id: string): HeroSource {
  const { context, ...binding } = useBinding(id, 'source');
  return { ...binding, start: (content, navigate) => { context.start(id, content, navigate); } };
}

export function useHeroTarget(id: string, active = true): HeroTarget {
  const { context, ...binding } = useBinding(id, 'target');
  const { blur } = context;
  useLayoutEffect(() => { if (!active) blur(id); }, [active, id, blur]);
  return { ...binding, settled: context.id !== id, back: (navigate) => { context.back(id, navigate); } };
}
