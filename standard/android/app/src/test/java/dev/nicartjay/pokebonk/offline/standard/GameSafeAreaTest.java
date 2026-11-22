package dev.nicartjay.pokebonk.offline.standard;

import org.junit.Test;
import static org.junit.Assert.*;

public final class GameSafeAreaTest {
    private void edges(GameSafeArea area, int left, int top, int right, int bottom) {
        assertEquals(left, area.left); assertEquals(top, area.top);
        assertEquals(right, area.right); assertEquals(bottom, area.bottom);
    }
    @Test public void olderDevicesKeepAConservativeFallbackEvenWithoutACutout() {
        edges(GameSafeArea.calculate(16, 4, new int[4], new int[4]), 16, 16, 16, 16);
    }
    @Test public void largeRoundedCornersGetEnoughClearanceWithoutAFullRadiusInset() {
        GameSafeArea area = GameSafeArea.calculate(16, 4, new int[4], new int[]{100, 100, 100, 100});
        edges(area, 34, 34, 34, 34);
        assertTrue(Math.hypot(100 - area.left, 100 - area.top) < 100);
        assertTrue(area.top < 100);
    }
    @Test public void asymmetricCornersAndNotchesAreAppliedToTheirPhysicalEdges() {
        edges(GameSafeArea.calculate(16, 4, new int[]{90, 0, 0, 24}, new int[]{100, 20, 0, 60}), 94, 34, 16, 28);
    }
    @Test public void reverseLandscapeMovesTheCutoutToTheOtherSide() {
        edges(GameSafeArea.calculate(16, 4, new int[]{0, 0, 90, 24}, new int[]{20, 100, 60, 0}), 16, 34, 94, 28);
    }
    @Test public void insetsCanShrinkAgainAfterRotationOrTransientBarsHide() {
        edges(GameSafeArea.calculate(16, 4, new int[]{0, 40, 90, 24}, new int[4]), 16, 44, 94, 28);
        edges(GameSafeArea.calculate(16, 4, new int[4], new int[4]), 16, 16, 16, 16);
    }
    @Test public void invalidGeometryDoesNotProduceUnboundedPresentationCode() {
        assertThrows(IllegalArgumentException.class, () -> GameSafeArea.calculate(-1, 4, new int[4], new int[4]));
        assertThrows(IllegalArgumentException.class, () -> GameSafeArea.calculate(16, 4, new int[3], new int[4]));
        edges(GameSafeArea.calculate(16, 4, new int[]{-1, -2, -3, -4}, new int[]{-1, -2, -3, -4}), 16, 16, 16, 16);
    }
}
