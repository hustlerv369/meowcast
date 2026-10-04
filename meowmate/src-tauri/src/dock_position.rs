//! Persisted monitor-relative anchors. Geometry uses physical pixels throughout.
use serde::{Deserialize, Serialize};
use windows::Win32::Foundation::{POINT, RECT};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Edge { Bottom, Left, Right, Top }

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Anchor {
    pub monitor: String,
    pub edge: Edge,
    pub fraction: f64,
}

pub fn nearest_edge(work: RECT, p: POINT) -> Edge {
    [(p.y-work.bottom).abs(), (p.x-work.left).abs(),
     (p.x-work.right).abs(), (p.y-work.top).abs()]
        .iter().enumerate().min_by_key(|(_, distance)| *distance)
        .map(|(index, _)| [Edge::Bottom, Edge::Left, Edge::Right, Edge::Top][index])
        .unwrap_or(Edge::Bottom)
}

pub fn fraction(work: RECT, p: POINT, edge: Edge) -> f64 {
    let (v, start, length) = match edge {
        Edge::Bottom | Edge::Top => (p.x, work.left, work.right-work.left),
        _ => (p.y, work.top, work.bottom-work.top),
    };
    ((v-start) as f64 / length.max(1) as f64).clamp(0.0, 1.0)
}

pub fn position(work: RECT, scale: f64, edge: Edge, fraction: f64) -> RECT {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let f = if fraction.is_finite() { fraction.clamp(0.0, 1.0) } else { 0.75 };
    let w = (224.0*scale).round().max(1.0) as i32;
    let h = (52.0*scale).round().max(1.0) as i32;
    let w = w.min((work.right-work.left).max(1));
    let h = h.min((work.bottom-work.top).max(1));
    let x = (work.left as f64 + f*(work.right-work.left) as f64 - w as f64/2.0).round() as i32;
    let y = (work.top as f64 + f*(work.bottom-work.top) as f64 - h as f64/2.0).round() as i32;
    let (x, y) = match edge {
        Edge::Bottom => (x, work.bottom-h), Edge::Top => (x, work.top),
        Edge::Left => (work.left, y), Edge::Right => (work.right-w, y),
    };
    let x = x.clamp(work.left, (work.right-w).max(work.left));
    let y = y.clamp(work.top, (work.bottom-h).max(work.top));
    RECT {left:x, top:y, right:x+w, bottom:y+h}
}

/// Popup meets the capsule edge. No invisible 320px gap before the visible UI.
pub fn popup(work: RECT, slot: RECT, edge: Edge, scale: f64) -> RECT {
    let w = ((super::island::PANEL_W*scale).round() as i32).min(work.right-work.left).max(1);
    let h = ((super::island::PANEL_H*scale).round() as i32).min(work.bottom-work.top).max(1);
    let gap = (4.0*scale).round() as i32;
    let cx = (slot.left+slot.right-w)/2;
    let (x,y) = match edge {
        Edge::Bottom => (cx, slot.top-h-gap), Edge::Top => (cx, slot.bottom+gap),
        Edge::Left => (slot.right+gap, slot.bottom-h),
        Edge::Right => (slot.left-w-gap, slot.bottom-h),
    };
    let x = x.clamp(work.left,(work.right-w).max(work.left));
    let y = y.clamp(work.top,(work.bottom-h).max(work.top));
    RECT {left:x,top:y,right:x+w,bottom:y+h}
}

#[cfg(test)]
mod tests {
    use super::*;
    fn work()->RECT { RECT {left:-1920,top:-200,right:0,bottom:840} }
    #[test] fn anchors_stay_on_each_edge_at_fractional_dpi() {
        let r=work();
        for s in [1.0,1.25,1.5,2.0] { for edge in [Edge::Bottom,Edge::Left,Edge::Right,Edge::Top] {
            for f in [-1.0,0.0,0.5,1.0,2.0,f64::NAN] {
                let p=position(r,s,edge,f);
                assert!(p.left>=r.left && p.right<=r.right && p.top>=r.top && p.bottom<=r.bottom);
                assert!(match edge {Edge::Bottom=>p.bottom==r.bottom,Edge::Top=>p.top==r.top,Edge::Left=>p.left==r.left,Edge::Right=>p.right==r.right});
            }
        }}
    }
    #[test] fn drag_selects_nearest_edge_and_normalizes() {
        let p=POINT{x:-1700,y:835}; let e=nearest_edge(work(),p);
        assert_eq!(e,Edge::Bottom);
        assert!((fraction(work(),p,e)-220.0/1920.0).abs()<0.0001);
        assert_eq!(nearest_edge(work(),POINT{x:-1918,y:200}),Edge::Left);
    }
    #[test] fn popup_is_clamped_on_small_and_negative_monitors() {
        for scale in [1.0,1.25,2.0] {for edge in [Edge::Bottom,Edge::Top,Edge::Left,Edge::Right] {
            let work=work();let slot=position(work,scale,edge,0.99);
            let p=popup(work,slot,edge,scale);
            assert!(p.left>=work.left&&p.top>=work.top&&p.right<=work.right&&p.bottom<=work.bottom);
        }}
    }
}
