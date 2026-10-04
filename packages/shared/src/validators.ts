export type FormValidationError = {
  field: string;
  code: 'required' | 'invalid' | 'out_of_range' | 'duplicate' | 'unsorted'
    | 'too_many' | 'mismatch' | 'unknown_key';
};

export function validatePet(_value: unknown): FormValidationError[] {
  void _value;
  throw new Error('not implemented');
}

export function validateWeight(_value: unknown): FormValidationError[] {
  void _value;
  throw new Error('not implemented');
}

export function validateHealthEvent(_value: unknown): FormValidationError[] {
  void _value;
  throw new Error('not implemented');
}

export function validateTask(_value: unknown): FormValidationError[] {
  void _value;
  throw new Error('not implemented');
}

export function validatePassword(_value: unknown): FormValidationError[] {
  void _value;
  throw new Error('not implemented');
}
