import { UIProvider } from "@semicoder/malatang-sdk/ui";
import React, { Component, createRef } from "react";

type Props = {
  pluginId?: string;
  visible: boolean;
  keepAlive: boolean;
  label: string;
  children: React.ReactNode;
};

/** Owns a page's lifetime and scroll position, independently of navigation. */
export default class PageSlot extends Component<Props, { visited: boolean }> {
  state = { visited: false };
  private container = createRef<HTMLElement>();
  private scroll = { top: 0, left: 0 };

  static getDerivedStateFromProps(props: Props, state: { visited: boolean }) {
    return props.visible && !state.visited ? { visited: true } : null;
  }

  getSnapshotBeforeUpdate(previous: Props) {
    const node = this.container.current;
    // Capture before `hidden` changes layout and can reset DOM scroll offsets.
    if (previous.visible && !this.props.visible && node) {
      this.scroll = { top: node.scrollTop, left: node.scrollLeft };
    }
    return null;
  }

  componentDidUpdate(previous: Props) {
    if (this.props.visible && !previous.visible && this.container.current) {
      this.container.current.scrollTop = this.props.keepAlive ? this.scroll.top : 0;
      this.container.current.scrollLeft = this.props.keepAlive ? this.scroll.left : 0;
    }
  }

  render() {
    const { visible, keepAlive, label, children } = this.props;
    if (!visible && (!keepAlive || !this.state.visited)) return null;
    return (
      <section
        ref={this.container}
        className="page-scroll"
        aria-label={label}
        hidden={!visible}
        inert={!visible}
        aria-hidden={!visible || undefined}
      >
        <UIProvider visible={visible} pluginId={this.props.pluginId}>
          {children}
        </UIProvider>
      </section>
    );
  }
}
