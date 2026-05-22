import assert from 'node:assert/strict';
import { test } from 'bun:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { IconSpriteProvider } from '../src/components/icon-sprite-manager';
import StatusButton from '../src/components/status-button';

function renderStatusButton(className: string, size?: string) {
  return renderToStaticMarkup(
    <IconSpriteProvider>
      <StatusButton
        size={size}
        title="Action"
        alt="Action"
        className={className}
        icon="comment"
      />
    </IconSpriteProvider>,
  );
}

test('StatusButton preserves React className modifiers', () => {
  assert.match(
    renderStatusButton('reply-button', 's'),
    /class="plain small reply-button"/,
  );
  assert.match(
    renderStatusButton('favourite-button'),
    /class="plain favourite-button"/,
  );
});
