import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
    path.join(process.cwd(), 'src/components/ui/button.tsx'),
    'utf8'
);

describe('shared button interaction contract', () => {
    it('does not move controls under the pointer', () => {
        expect(source).not.toContain('active:scale');
        expect(source).not.toContain('transition-all');
    });

    it('does not silently discard rapid legitimate clicks', () => {
        expect(source).not.toContain('lastClickRef');
        expect(source).not.toContain('disableClickGuard');
        expect(source).not.toContain('Date.now()');
        expect(source).not.toContain('event.preventDefault()');
    });
});
