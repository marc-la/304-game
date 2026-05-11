// Engine error hierarchy. Mirrors game304/errors.py.
// All engine-thrown errors extend GameError; callers can catch the
// base class for any rule violation, or a specific subclass for finer
// control.

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidPhaseError extends GameError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPhaseError';
  }
}

export class NotYourTurnError extends GameError {
  constructor(message: string) {
    super(message);
    this.name = 'NotYourTurnError';
  }
}

export class InvalidBidError extends GameError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBidError';
  }
}

export class InvalidPlayError extends GameError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPlayError';
  }
}

export class InvalidTrumpSelectionError extends GameError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTrumpSelectionError';
  }
}

export class CapsError extends GameError {
  constructor(message: string) {
    super(message);
    this.name = 'CapsError';
  }
}
