import type { gsap } from "gsap";
import type { ReactElement } from "react";

/** A canvas size the scene system renders at. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface SceneMarkup {
  readonly id: string;
  readonly render: (size: Size) => ReactElement;
}

export type SceneMotion = (tl: gsap.core.Timeline, root: HTMLElement) => void;

export interface Shot {
  readonly scene: string;
  readonly start: number;
  readonly duration: number;
}

export interface Cut extends Size {
  readonly id: string;
  readonly shots: ReadonlyArray<Shot>;
}
