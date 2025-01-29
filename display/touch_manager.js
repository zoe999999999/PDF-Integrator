/* Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { shadow } from "../shared/util.js";
import { stopEvent } from "./display_utils.js";

class TouchManager {
  #container;

  #isPinching = false;

  #isPinchingStopped = null;

  #isPinchingDisabled;

  #onPinchStart;

  #onPinching;

  #onPinchEnd;

  #signal;

  #touchInfo = null;

  #touchManagerAC;

  #touchMoveAC = null;

  constructor({
    container,
    isPinchingDisabled = null,
    isPinchingStopped = null,
    onPinchStart = null,
    onPinching = null,
    onPinchEnd = null,
    signal,
  }) {
    this.#container = container;
    this.#isPinchingStopped = isPinchingStopped;
    this.#isPinchingDisabled = isPinchingDisabled;
    this.#onPinchStart = onPinchStart;
    this.#onPinching = onPinching;
    this.#onPinchEnd = onPinchEnd;
    this.#touchManagerAC = new AbortController();
    this.#signal = AbortSignal.any([signal, this.#touchManagerAC.signal]);

    container.addEventListener("touchstart", this.#onTouchStart.bind(this), {
      passive: false,
      signal: this.#signal,
    });
  }

  get MIN_TOUCH_DISTANCE_TO_PINCH() {
    // The 35 is coming from:
    //  https://searchfox.org/mozilla-central/source/gfx/layers/apz/src/GestureEventListener.cpp#36
    //
    // The properties TouchEvent::screenX/Y are in screen CSS pixels:
    //  https://developer.mozilla.org/en-US/docs/Web/API/Touch/screenX#examples
    // MIN_TOUCH_DISTANCE_TO_PINCH is in CSS pixels.
    return shadow(
      this,
      "MIN_TOUCH_DISTANCE_TO_PINCH",
      35 / (window.devicePixelRatio || 1)
    );
  }

  #onTouchStart(evt) {
    if (this.#isPinchingDisabled?.() || evt.touches.length < 2) {
      return;
    }

    if (!this.#touchMoveAC) {
      this.#touchMoveAC = new AbortController();
      const signal = AbortSignal.any([this.#signal, this.#touchMoveAC.signal]);
      const container = this.#container;
      const opt = { signal, passive: false };
      container.addEventListener(
        "touchmove",
        this.#onTouchMove.bind(this),
        opt
      );
      container.addEventListener("touchend", this.#onTouchEnd.bind(this), opt);
      container.addEventListener(
        "touchcancel",
        this.#onTouchEnd.bind(this),
        opt
      );
      this.#onPinchStart?.();
    }

    stopEvent(evt);

    if (evt.touches.length !== 2 || this.#isPinchingStopped?.()) {
      this.#touchInfo = null;
      return;
    }

    let [touch0, touch1] = evt.touches;
    if (touch0.identifier > touch1.identifier) {
      [touch0, touch1] = [touch1, touch0];
    }
    this.#touchInfo = {
      touch0X: touch0.screenX,
      touch0Y: touch0.screenY,
      touch1X: touch1.screenX,
      touch1Y: touch1.screenY,
    };
  }

  #onTouchMove(evt) {
    if (!this.#touchInfo || evt.touches.length !== 2) {
      return;
    }

    let [touch0, touch1] = evt.touches;
    if (touch0.identifier > touch1.identifier) {
      [touch0, touch1] = [touch1, touch0];
    }
    const { screenX: screen0X, screenY: screen0Y } = touch0;
    const { screenX: screen1X, screenY: screen1Y } = touch1;
    const touchInfo = this.#touchInfo;
    const {
      touch0X: pTouch0X,
      touch0Y: pTouch0Y,
      touch1X: pTouch1X,
      touch1Y: pTouch1Y,
    } = touchInfo;

    const prevGapX = pTouch1X - pTouch0X;
    const prevGapY = pTouch1Y - pTouch0Y;
    const currGapX = screen1X - screen0X;
    const currGapY = screen1Y - screen0Y;

    const distance = Math.hypot(currGapX, currGapY) || 1;
    const pDistance = Math.hypot(prevGapX, prevGapY) || 1;
    if (
      !this.#isPinching &&
      Math.abs(pDistance - distance) <= TouchManager.MIN_TOUCH_DISTANCE_TO_PINCH
    ) {
      return;
    }

    touchInfo.touch0X = screen0X;
    touchInfo.touch0Y = screen0Y;
    touchInfo.touch1X = screen1X;
    touchInfo.touch1Y = screen1Y;

    evt.preventDefault();

    if (!this.#isPinching) {
      // Start pinching.
      this.#isPinching = true;

      // We return here else the first pinch is a bit too much
      return;
    }

    const origin = [(screen0X + screen1X) / 2, (screen0Y + screen1Y) / 2];
    this.#onPinching?.(origin, pDistance, distance);
  }

  #onTouchEnd(evt) {
    this.#touchMoveAC.abort();
    this.#touchMoveAC = null;
    this.#onPinchEnd?.();

    if (!this.#touchInfo) {
      return;
    }

    evt.preventDefault();
    this.#touchInfo = null;
    this.#isPinching = false;
  }

  destroy() {
    this.#touchManagerAC?.abort();
    this.#touchManagerAC = null;
  }
}

export { TouchManager };
