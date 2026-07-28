import { useCallback, useState } from "react";

export function usePanelLayout() {
    const [sidebarWidth, setSidebarWidth] = useState(252);
    const [detailsWidth, setDetailsWidth] = useState(370);
    const [leftPanelVisible, setLeftPanelVisible] = useState(true);
    const [rightPanelVisible, setRightPanelVisible] = useState(true);

    const beginResize = useCallback((side: "left" | "right", startEvent: React.PointerEvent) => {
        startEvent.currentTarget.setPointerCapture(startEvent.pointerId);
        const startX = startEvent.clientX;
        const startWidth = side === "left" ? sidebarWidth : detailsWidth;
        const move = (event: PointerEvent) => {
            const delta = event.clientX - startX;
            if (side === "left") setSidebarWidth(Math.max(190, Math.min(380, startWidth + delta)));
            else setDetailsWidth(Math.max(300, Math.min(560, startWidth - delta)));
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [detailsWidth, sidebarWidth]);

    return {
        beginResize,
        detailsWidth,
        leftPanelVisible,
        rightPanelVisible,
        setLeftPanelVisible,
        setRightPanelVisible,
        sidebarWidth,
    };
}
