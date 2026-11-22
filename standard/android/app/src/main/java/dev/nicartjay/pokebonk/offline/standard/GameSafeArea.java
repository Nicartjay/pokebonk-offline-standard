package dev.nicartjay.pokebonk.offline.standard;

/** Pure pixel geometry, independently testable without a device or WebView. */
final class GameSafeArea {
    static final int MINIMUM_DP = 16, GAP_DP = 4, MENU_GAP_DP = 8;
    final int left, top, right, bottom;

    private GameSafeArea(int left, int top, int right, int bottom) {
        this.left = left; this.top = top; this.right = right; this.bottom = bottom;
    }

    // Obstructions: L,T,R,B. Corner radii: TL,TR,BR,BL, in the current rotation.
    static GameSafeArea calculate(int minimum, int gap, int[] obstructions, int[] radii) {
        if (minimum < 0 || gap < 0 || obstructions.length != 4 || radii.length != 4) {
            throw new IllegalArgumentException("Invalid safe-area geometry.");
        }
        int[] corners = new int[4], edges = new int[4];
        for (int i = 0; i < 4; i++) {
            // The equal x/y point on a quarter-circle: r * (1 - 1/sqrt(2)).
            // A full-radius inset would waste a large part of a short screen.
            corners[i] = radii[i] > 0 ? (int) Math.ceil(radii[i] * (1 - Math.sqrt(0.5))) + gap : 0;
            edges[i] = Math.max(minimum, obstructions[i] > 0 ? obstructions[i] + gap : 0);
        }
        return new GameSafeArea(
            Math.max(edges[0], Math.max(corners[0], corners[3])),
            Math.max(edges[1], Math.max(corners[0], corners[1])),
            Math.max(edges[2], Math.max(corners[1], corners[2])),
            Math.max(edges[3], Math.max(corners[2], corners[3])));
    }
}
