var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function set_custom_element_data(node, prop, value) {
        if (prop in node) {
            node[prop] = value;
        }
        else {
            attr(node, prop, value);
        }
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            $$.fragment && $$.fragment.p($$.ctx, $$.dirty);
            $$.dirty = [-1];
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }

    const globals = (typeof window !== 'undefined' ? window : global);
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, value = ret) => {
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, detail));
    }
    function append_dev(target, node) {
        dispatch_dev("SvelteDOMInsert", { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev("SvelteDOMInsert", { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev("SvelteDOMRemove", { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ["capture"] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev("SvelteDOMAddEventListener", { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev("SvelteDOMRemoveEventListener", { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev("SvelteDOMRemoveAttribute", { node, attribute });
        else
            dispatch_dev("SvelteDOMSetAttribute", { node, attribute, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        dispatch_dev("SvelteDOMSetData", { node: text, data });
        text.data = data;
    }
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error(`'target' is a required option`);
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn(`Component was already destroyed`); // eslint-disable-line no-console
            };
        }
    }

    /* src\App.svelte generated by Svelte v3.16.0 */

    const { document: document_1 } = globals;
    const file = "src\\App.svelte";

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-124kns6-style";
    	style.textContent = ".app.svelte-124kns6{margin:20px;display:grid;grid-template-columns:auto 1fr}@media only screen and (max-width: 550px){.app.svelte-124kns6{grid-template-columns:1fr}}.image-thumbnails-wrapper.svelte-124kns6{display:grid;grid-template-columns:repeat(auto-fill, minmax(100px, 185px));grid-template-rows:repeat(auto-fill, minmax(100px, 275px));justify-content:center;grid-gap:20px;margin:10px}.image-thumbnails-wrapper.svelte-124kns6 .image-thumbnail.svelte-124kns6{border:1px solid black;border-radius:5px;padding:10px;display:flex;flex-direction:column;align-items:center}.image-thumbnails-wrapper.svelte-124kns6 .image-thumbnail img.svelte-124kns6{width:150px;height:150px}.image-thumbnails-wrapper.svelte-124kns6 .image-thumbnail p.svelte-124kns6{text-align:center;max-width:160px;max-height:20px;overflow:hidden;text-overflow:ellipsis;padding:0 15px}.image-thumbnails-wrapper.svelte-124kns6 .image-thumbnail zoo-button.svelte-124kns6{cursor:pointer;height:45px;display:block}.modal-window.svelte-124kns6 .modal-content.svelte-124kns6{display:grid;grid-template-columns:400px 1fr;max-height:700px;max-width:100%}@media only screen and (max-width: 720px){.modal-window.svelte-124kns6 .modal-content.svelte-124kns6{grid-template-columns:1fr}}.modal-window.svelte-124kns6 .modal-content img.svelte-124kns6{max-height:500px;width:100%}.modal-window.svelte-124kns6 .modal-content .action-buttons.svelte-124kns6{display:flex;flex-direction:column;margin:10px;gap:10px}.modal-window.svelte-124kns6 .modal-content .action-buttons .rename.svelte-124kns6{display:flex;flex-direction:column;padding:5px;border:1px solid black;border-radius:5px}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXBwLnN2ZWx0ZSIsInNvdXJjZXMiOlsiQXBwLnN2ZWx0ZSJdLCJzb3VyY2VzQ29udGVudCI6WyI8em9vLWhlYWRlciBpbWdzcmM9XCJsb2dvLmpwZ1wiIGltZ2FsdD1cImltZ2FsdFwiIGhlYWRlcnRleHQ9XCJJbWFnZSB2aWV3ZXJcIj48L3pvby1oZWFkZXI+XHJcbjxkaXYgY2xhc3M9XCJhcHBcIj5cclxuXHQ8em9vLXRvYXN0IGJpbmQ6dGhpcz17X21vZGFsVG9hc3R9Pjwvem9vLXRvYXN0PlxyXG5cdDx6b28tdG9hc3QgdHlwZT1cImVycm9yXCIgYmluZDp0aGlzPXtfZXJyb3JUb2FzdH0+PC96b28tdG9hc3Q+XHJcblx0PGRpdiBjbGFzcz1cIm1lbnVcIj5cclxuXHRcdDxkaXYgc3R5bGU9XCJ3aWR0aDogMjUwcHg7XCI+XHJcblx0PC9kaXY+XHJcblx0XHQ8em9vLWlucHV0IGxhYmVsdGV4dD1cIkNob29zZSBpbWFnZXMgdG8gdXBsb2FkXCIgaW5mb3RleHQ9XCJTdXBwb3J0ZWQgZXh0ZW5zaW9ucyBhcmU6IC5qcGcsIC5qcGVnLCAucG5nXCI+XHJcblx0XHRcdDxpbnB1dCBzbG90PVwiaW5wdXRlbGVtZW50XCIgdHlwZT1cImZpbGVcIiBtdWx0aXBsZSBhY2NlcHQ9XCIuanBnLCAuanBlZywgLnBuZ1wiIG9uOmNoYW5nZT1cIntlID0+IGhhbmRsZUZpbGVVcGxvYWQoZSl9XCIgYmluZDp0aGlzPXtfaW5wdXR9Lz5cclxuXHRcdDwvem9vLWlucHV0PlxyXG5cdDwvZGl2PlxyXG5cdDxkaXYgY2xhc3M9XCJpbWFnZS10aHVtYm5haWxzLXdyYXBwZXJcIj5cclxuXHRcdHsjZWFjaCBpbWFnZXMgYXMgaW1hZ2UsIGl9XHJcblx0XHRcdDxkaXYgY2xhc3M9XCJpbWFnZS10aHVtYm5haWxcIj5cclxuXHRcdFx0XHQ8aW1nIHNyYz17aW1hZ2UuZGF0YX0gYWx0PVwiaW1hZ2VcIi8+XHJcblx0XHRcdFx0PHA+e2ltYWdlLm5hbWV9PC9wPlxyXG5cdFx0XHRcdDx6b28tYnV0dG9uIG9uOmNsaWNrPVwieygpID0+IG9wZW5EZXRhaWxzVmlldyhpKX1cIj5cclxuXHRcdFx0XHRcdDxzcGFuIHNsb3Q9XCJidXR0b25jb250ZW50XCI+T3BlbiBkZXRhaWxzIHZpZXc8L3NwYW4+XHJcblx0XHRcdFx0PC96b28tYnV0dG9uPlxyXG5cdFx0XHQ8L2Rpdj5cclxuXHRcdHs6ZWxzZX1cclxuXHRcdFx0PHA+WW91IGhhdmVuJ3QgdXBsb2FkZWQgYW55IGltYWdlcyB5ZXQhPC9wPlxyXG5cdFx0ey9lYWNofVxyXG5cdDwvZGl2PlxyXG5cdDx6b28tbW9kYWwgYmluZDp0aGlzPXtfbW9kYWx9IGNsYXNzPVwibW9kYWwtd2luZG93XCI+XHJcblx0XHQ8ZGl2IGNsYXNzPVwibW9kYWwtY29udGVudFwiPlxyXG5cdFx0XHQ8ZGl2IGNsYXNzPVwiYWN0aW9uLWJ1dHRvbnNcIj5cclxuXHRcdFx0XHQ8ZGl2IGNsYXNzPVwicmVuYW1lXCI+XHJcblx0XHRcdFx0XHQ8em9vLWlucHV0IGxhYmVsdGV4dD1cIlJlbmFtZSB5b3VyIGZpbGUuXCI+XHJcblx0XHRcdFx0XHRcdDxpbnB1dCBzbG90PVwiaW5wdXRlbGVtZW50XCIgdHlwZT1cInRleHRcIi8+XHJcblx0XHRcdFx0XHQ8L3pvby1pbnB1dD5cclxuXHRcdFx0XHRcdDx6b28tYnV0dG9uIG9uOmNsaWNrPVwieygpID0+IGhhbmRsZVJlbmFtZUJ1dHRvbkNsaWNrKCl9XCI+XHJcblx0XHRcdFx0XHRcdDxzcGFuIHNsb3Q9XCJidXR0b25jb250ZW50XCI+UmVuYW1lIGltYWdlPC9zcGFuPlxyXG5cdFx0XHRcdFx0PC96b28tYnV0dG9uPlxyXG5cdFx0XHRcdDwvZGl2PlxyXG5cdFx0XHRcdDx6b28tYnV0dG9uIHR5cGU9XCJob3RcIiBvbjpjbGljaz1cInsoKSA9PiByZW1vdmVJbWFnZSgpfVwiPlxyXG5cdFx0XHRcdFx0PHNwYW4gc2xvdD1cImJ1dHRvbmNvbnRlbnRcIj5SZW1vdmUgaW1hZ2U8L3NwYW4+XHJcblx0XHRcdFx0PC96b28tYnV0dG9uPlxyXG5cdFx0XHQ8L2Rpdj5cclxuXHRcdFx0PGRpdiBjbGFzcz1cImltYWdlLWluZm9cIj5cclxuXHRcdFx0XHQ8aW1nIGFsdD1cImltYWdlXCIvPlxyXG5cdFx0XHRcdDx1bD48L3VsPlxyXG5cdFx0XHQ8L2Rpdj5cclxuXHRcdDwvZGl2PlxyXG5cdDwvem9vLW1vZGFsPlxyXG48L2Rpdj5cclxuXHJcbjxzdHlsZSB0eXBlPVwidGV4dC9zY3NzXCI+LmFwcCB7XG4gIG1hcmdpbjogMjBweDtcbiAgZGlzcGxheTogZ3JpZDtcbiAgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiBhdXRvIDFmcjsgfVxuICBAbWVkaWEgb25seSBzY3JlZW4gYW5kIChtYXgtd2lkdGg6IDU1MHB4KSB7XG4gICAgLmFwcCB7XG4gICAgICBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmcjsgfSB9XG5cbi5pbWFnZS10aHVtYm5haWxzLXdyYXBwZXIge1xuICBkaXNwbGF5OiBncmlkO1xuICBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IHJlcGVhdChhdXRvLWZpbGwsIG1pbm1heCgxMDBweCwgMTg1cHgpKTtcbiAgZ3JpZC10ZW1wbGF0ZS1yb3dzOiByZXBlYXQoYXV0by1maWxsLCBtaW5tYXgoMTAwcHgsIDI3NXB4KSk7XG4gIGp1c3RpZnktY29udGVudDogY2VudGVyO1xuICBncmlkLWdhcDogMjBweDtcbiAgbWFyZ2luOiAxMHB4OyB9XG4gIC5pbWFnZS10aHVtYm5haWxzLXdyYXBwZXIgLmltYWdlLXRodW1ibmFpbCB7XG4gICAgYm9yZGVyOiAxcHggc29saWQgYmxhY2s7XG4gICAgYm9yZGVyLXJhZGl1czogNXB4O1xuICAgIHBhZGRpbmc6IDEwcHg7XG4gICAgZGlzcGxheTogZmxleDtcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xuICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7IH1cbiAgICAuaW1hZ2UtdGh1bWJuYWlscy13cmFwcGVyIC5pbWFnZS10aHVtYm5haWwgaW1nIHtcbiAgICAgIHdpZHRoOiAxNTBweDtcbiAgICAgIGhlaWdodDogMTUwcHg7IH1cbiAgICAuaW1hZ2UtdGh1bWJuYWlscy13cmFwcGVyIC5pbWFnZS10aHVtYm5haWwgcCB7XG4gICAgICB0ZXh0LWFsaWduOiBjZW50ZXI7XG4gICAgICBtYXgtd2lkdGg6IDE2MHB4O1xuICAgICAgbWF4LWhlaWdodDogMjBweDtcbiAgICAgIG92ZXJmbG93OiBoaWRkZW47XG4gICAgICB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpcztcbiAgICAgIHBhZGRpbmc6IDAgMTVweDsgfVxuICAgIC5pbWFnZS10aHVtYm5haWxzLXdyYXBwZXIgLmltYWdlLXRodW1ibmFpbCB6b28tYnV0dG9uIHtcbiAgICAgIGN1cnNvcjogcG9pbnRlcjtcbiAgICAgIGhlaWdodDogNDVweDtcbiAgICAgIGRpc3BsYXk6IGJsb2NrOyB9XG5cbi5tb2RhbC13aW5kb3cgLm1vZGFsLWNvbnRlbnQge1xuICBkaXNwbGF5OiBncmlkO1xuICBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDQwMHB4IDFmcjtcbiAgbWF4LWhlaWdodDogNzAwcHg7XG4gIG1heC13aWR0aDogMTAwJTsgfVxuICBAbWVkaWEgb25seSBzY3JlZW4gYW5kIChtYXgtd2lkdGg6IDcyMHB4KSB7XG4gICAgLm1vZGFsLXdpbmRvdyAubW9kYWwtY29udGVudCB7XG4gICAgICBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmcjsgfSB9XG4gIC5tb2RhbC13aW5kb3cgLm1vZGFsLWNvbnRlbnQgaW1nIHtcbiAgICBtYXgtaGVpZ2h0OiA1MDBweDtcbiAgICB3aWR0aDogMTAwJTsgfVxuICAubW9kYWwtd2luZG93IC5tb2RhbC1jb250ZW50IC5hY3Rpb24tYnV0dG9ucyB7XG4gICAgZGlzcGxheTogZmxleDtcbiAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xuICAgIG1hcmdpbjogMTBweDtcbiAgICBnYXA6IDEwcHg7IH1cbiAgICAubW9kYWwtd2luZG93IC5tb2RhbC1jb250ZW50IC5hY3Rpb24tYnV0dG9ucyAucmVuYW1lIHtcbiAgICAgIGRpc3BsYXk6IGZsZXg7XG4gICAgICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xuICAgICAgcGFkZGluZzogNXB4O1xuICAgICAgYm9yZGVyOiAxcHggc29saWQgYmxhY2s7XG4gICAgICBib3JkZXItcmFkaXVzOiA1cHg7IH1cbiAgLm1vZGFsLXdpbmRvdyAubW9kYWwtY29udGVudCB6b28tZmVlZGJhY2sge1xuICAgIG1hcmdpbjogNXB4OyB9XG5cbi8qIyBzb3VyY2VNYXBwaW5nVVJMPXgubWFwICovPC9zdHlsZT5cclxuXHJcbjxzY3JpcHQ+XHJcblx0bGV0IGltYWdlcyA9IFtdO1xyXG5cdGxldCBfaW5wdXQ7XHJcblx0bGV0IF9tb2RhbDtcclxuXHRsZXQgX21vZGFsVG9hc3Q7XHJcblx0bGV0IF9tb2RhbEltZztcclxuXHRsZXQgX2lkeDtcclxuXHRsZXQgX2Vycm9yVG9hc3Q7XHJcblx0Y29uc3Qgc3VwcG9ydGVkRXh0ZW5zaW9ucyA9IFsnaW1hZ2UvanBnJywgJ2ltYWdlL2pwZWcnLCAnaW1hZ2UvcG5nJ107XHJcblxyXG5cdGNvbnN0IGhhbmRsZUZpbGVVcGxvYWQgPSBlID0+IHtcclxuXHRcdGNvbnN0IHRlbXAgPSBbLi4uaW1hZ2VzXTtcclxuXHRcdGxldCBiYWRGaWxlcyA9IFtdO1xyXG5cdFx0Zm9yIChsZXQgaSA9IDA7IGkgPCBfaW5wdXQuZmlsZXMubGVuZ3RoOyBpKyspIHtcclxuXHRcdFx0Y29uc3QgZmlsZSA9IF9pbnB1dC5maWxlc1tpXTtcclxuXHRcdFx0aWYgKCFzdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGZpbGUudHlwZSkpIHtcclxuXHRcdFx0XHRiYWRGaWxlcy5wdXNoKGZpbGUubmFtZSk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0dGVtcC5wdXNoKHtcclxuXHRcdFx0XHRcdGRhdGE6IHdpbmRvdy5VUkwuY3JlYXRlT2JqZWN0VVJMKGZpbGUpLFxyXG5cdFx0XHRcdFx0bmFtZTogZmlsZS5uYW1lLFxyXG5cdFx0XHRcdFx0c2l6ZTogZmlsZS5zaXplLFxyXG5cdFx0XHRcdFx0dHlwZTogZmlsZS50eXBlLFxyXG5cdFx0XHRcdFx0bGFzdE1vZGlmaWVkOiBmaWxlLmxhc3RNb2RpZmllZFxyXG5cdFx0XHRcdH0pO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblxyXG5cdFx0aWYgKGJhZEZpbGVzLmxlbmd0aCA+IDApIHtcclxuXHRcdFx0X2Vycm9yVG9hc3QudGV4dCA9IGBDb3VsZCBub3QgdXBsb2FkICR7YmFkRmlsZXMubGVuZ3RofSBmaWxlcy4gRmlsZSBuYW1lcyBhcmU6ICR7YmFkRmlsZXMuam9pbignLCAnKX1gO1xyXG5cdFx0XHRfZXJyb3JUb2FzdC5zaG93KCk7XHJcblx0XHRcdGJhZEZpbGVzID0gW107XHJcblx0XHR9XHJcblx0XHRpbWFnZXMgPSB0ZW1wO1xyXG5cdFx0X2lucHV0LnZhbHVlID0gbnVsbDtcclxuXHR9XHJcblxyXG5cdGNvbnN0IHJlbW92ZUltYWdlID0gKCkgPT4ge1xyXG5cdFx0aW1hZ2VzID0gaW1hZ2VzLmZpbHRlcigoaW1nLCBpKSA9PiBpICE9PSBfaWR4KTtcclxuXHRcdF9tb2RhbFRvYXN0LnRleHQgPSAnSW1hZ2Ugd2FzIHN1Y2Nlc2Z1bGx5IHJlbW92ZWQhJztcclxuXHRcdF9tb2RhbFRvYXN0LnNob3coKTtcclxuXHRcdF9tb2RhbC5jbG9zZU1vZGFsKCk7XHJcblx0fVxyXG5cclxuXHRjb25zdCBoYW5kbGVSZW5hbWVCdXR0b25DbGljayA9ICgpID0+IHtcclxuXHRcdGltYWdlc1tfaWR4XS5uYW1lID0gX21vZGFsLnF1ZXJ5U2VsZWN0b3IoJ2lucHV0JykudmFsdWU7XHJcblx0XHRfbW9kYWxUb2FzdC50ZXh0ID0gJ0ltYWdlIHdhcyBzdWNjZXNmdWxseSByZW5hbWVkISc7XHJcblx0XHRfbW9kYWxUb2FzdC5zaG93KCk7XHJcblx0XHRfbW9kYWwuY2xvc2VNb2RhbCgpO1xyXG5cdH1cclxuXHJcblx0Y29uc3Qgb3BlbkRldGFpbHNWaWV3ID0gaWR4ID0+IHtcclxuXHRcdF9pZHggPSBpZHg7XHJcblx0XHRjb25zdCBpbWcgPSBpbWFnZXNbX2lkeF07XHJcblx0XHRjb25zdCBpbWdOYW1lID0gaW1nLm5hbWU7XHJcblx0XHRfbW9kYWwuaGVhZGVydGV4dCA9IGltZ05hbWU7XHJcblx0XHRfbW9kYWwucXVlcnlTZWxlY3RvcignaW1nJykuc3JjID0gaW1nLmRhdGE7XHJcblx0XHRfbW9kYWwucXVlcnlTZWxlY3RvcignaW5wdXQnKS52YWx1ZSA9IGltZ05hbWU7XHJcblxyXG5cdFx0Y29uc3QgdWwgPSBfbW9kYWwucXVlcnlTZWxlY3RvcigndWwnKTtcclxuXHRcdHVsLmlubmVySFRNTCA9ICcnO1xyXG5cclxuXHRcdGNvbnN0IHNpemUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdsaScpO1xyXG5cdFx0c2l6ZS50ZXh0Q29udGVudCA9IGBGaWxlIHNpemU6ICR7aW1nLnNpemV9IGJ5dGVzLmA7XHJcblx0XHR1bC5hcHBlbmRDaGlsZChzaXplKTtcclxuXHJcblx0XHRjb25zdCB0eXBlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGknKTtcclxuXHRcdHR5cGUudGV4dENvbnRlbnQgPSBgRmlsZSB0eXBlOiAke2ltZy50eXBlfS5gO1xyXG5cdFx0dWwuYXBwZW5kQ2hpbGQodHlwZSk7XHJcblxyXG5cdFx0Y29uc3QgbGFzdE1vZGlmaWVkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGknKTtcclxuXHRcdGxhc3RNb2RpZmllZC50ZXh0Q29udGVudCA9IGBMYXN0IG1vZGlmaWNhdGlvbiBkYXRlOiAke25ldyBEYXRlKGltZy5sYXN0TW9kaWZpZWQpLnRvSVNPU3RyaW5nKCl9LmA7XHJcblx0XHR1bC5hcHBlbmRDaGlsZChsYXN0TW9kaWZpZWQpO1xyXG5cclxuXHRcdF9tb2RhbC5zdHlsZS5kaXNwbGF5ID0gJ2Jsb2NrJztcclxuXHR9XHJcbjwvc2NyaXB0PiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUErQ3dCLElBQUksZUFBQyxDQUFDLEFBQzVCLE1BQU0sQ0FBRSxJQUFJ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 */";
    	append_dev(document_1.head, style);
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[20] = list[i];
    	child_ctx[22] = i;
    	return child_ctx;
    }

    // (21:2) {:else}
    function create_else_block(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "You haven't uploaded any images yet!";
    			attr_dev(p, "class", "svelte-124kns6");
    			add_location(p, file, 21, 3, 879);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block.name,
    		type: "else",
    		source: "(21:2) {:else}",
    		ctx
    	});

    	return block;
    }

    // (13:2) {#each images as image, i}
    function create_each_block(ctx) {
    	let div;
    	let img;
    	let img_src_value;
    	let t0;
    	let p;
    	let t1_value = /*image*/ ctx[20].name + "";
    	let t1;
    	let t2;
    	let zoo_button;
    	let span;
    	let t4;
    	let dispose;

    	function click_handler(...args) {
    		return /*click_handler*/ ctx[16](/*i*/ ctx[22], ...args);
    	}

    	const block = {
    		c: function create() {
    			div = element("div");
    			img = element("img");
    			t0 = space();
    			p = element("p");
    			t1 = text(t1_value);
    			t2 = space();
    			zoo_button = element("zoo-button");
    			span = element("span");
    			span.textContent = "Open details view";
    			t4 = space();
    			if (img.src !== (img_src_value = /*image*/ ctx[20].data)) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "image");
    			attr_dev(img, "class", "svelte-124kns6");
    			add_location(img, file, 14, 4, 659);
    			attr_dev(p, "class", "svelte-124kns6");
    			add_location(p, file, 15, 4, 700);
    			attr_dev(span, "slot", "buttoncontent");
    			add_location(span, file, 17, 5, 782);
    			set_custom_element_data(zoo_button, "class", "svelte-124kns6");
    			add_location(zoo_button, file, 16, 4, 725);
    			attr_dev(div, "class", "image-thumbnail svelte-124kns6");
    			add_location(div, file, 13, 3, 624);
    			dispose = listen_dev(zoo_button, "click", click_handler, false, false, false);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, img);
    			append_dev(div, t0);
    			append_dev(div, p);
    			append_dev(p, t1);
    			append_dev(div, t2);
    			append_dev(div, zoo_button);
    			append_dev(zoo_button, span);
    			append_dev(div, t4);
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty & /*images*/ 1 && img.src !== (img_src_value = /*image*/ ctx[20].data)) {
    				attr_dev(img, "src", img_src_value);
    			}

    			if (dirty & /*images*/ 1 && t1_value !== (t1_value = /*image*/ ctx[20].name + "")) set_data_dev(t1, t1_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(13:2) {#each images as image, i}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let zoo_header;
    	let t0;
    	let div7;
    	let zoo_toast0;
    	let t1;
    	let zoo_toast1;
    	let t2;
    	let div1;
    	let div0;
    	let t3;
    	let zoo_input0;
    	let input0;
    	let t4;
    	let div2;
    	let t5;
    	let zoo_modal;
    	let div6;
    	let div4;
    	let div3;
    	let zoo_input1;
    	let input1;
    	let t6;
    	let zoo_button0;
    	let span0;
    	let t8;
    	let zoo_button1;
    	let span1;
    	let t10;
    	let div5;
    	let img;
    	let t11;
    	let ul;
    	let dispose;
    	let each_value = /*images*/ ctx[0];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	let each_1_else = null;

    	if (!each_value.length) {
    		each_1_else = create_else_block(ctx);
    		each_1_else.c();
    	}

    	const block = {
    		c: function create() {
    			zoo_header = element("zoo-header");
    			t0 = space();
    			div7 = element("div");
    			zoo_toast0 = element("zoo-toast");
    			t1 = space();
    			zoo_toast1 = element("zoo-toast");
    			t2 = space();
    			div1 = element("div");
    			div0 = element("div");
    			t3 = space();
    			zoo_input0 = element("zoo-input");
    			input0 = element("input");
    			t4 = space();
    			div2 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t5 = space();
    			zoo_modal = element("zoo-modal");
    			div6 = element("div");
    			div4 = element("div");
    			div3 = element("div");
    			zoo_input1 = element("zoo-input");
    			input1 = element("input");
    			t6 = space();
    			zoo_button0 = element("zoo-button");
    			span0 = element("span");
    			span0.textContent = "Rename image";
    			t8 = space();
    			zoo_button1 = element("zoo-button");
    			span1 = element("span");
    			span1.textContent = "Remove image";
    			t10 = space();
    			div5 = element("div");
    			img = element("img");
    			t11 = space();
    			ul = element("ul");
    			set_custom_element_data(zoo_header, "imgsrc", "logo.jpg");
    			set_custom_element_data(zoo_header, "imgalt", "imgalt");
    			set_custom_element_data(zoo_header, "headertext", "Image viewer");
    			add_location(zoo_header, file, 0, 0, 0);
    			add_location(zoo_toast0, file, 2, 1, 107);
    			set_custom_element_data(zoo_toast1, "type", "error");
    			add_location(zoo_toast1, file, 3, 1, 157);
    			set_style(div0, "width", "250px");
    			add_location(div0, file, 5, 2, 242);
    			attr_dev(input0, "slot", "inputelement");
    			attr_dev(input0, "type", "file");
    			input0.multiple = true;
    			attr_dev(input0, "accept", ".jpg, .jpeg, .png");
    			add_location(input0, file, 8, 3, 389);
    			set_custom_element_data(zoo_input0, "labeltext", "Choose images to upload");
    			set_custom_element_data(zoo_input0, "infotext", "Supported extensions are: .jpg, .jpeg, .png");
    			add_location(zoo_input0, file, 7, 2, 282);
    			attr_dev(div1, "class", "menu");
    			add_location(div1, file, 4, 1, 220);
    			attr_dev(div2, "class", "image-thumbnails-wrapper svelte-124kns6");
    			add_location(div2, file, 11, 1, 551);
    			attr_dev(input1, "slot", "inputelement");
    			attr_dev(input1, "type", "text");
    			add_location(input1, file, 29, 6, 1142);
    			set_custom_element_data(zoo_input1, "labeltext", "Rename your file.");
    			add_location(zoo_input1, file, 28, 5, 1093);
    			attr_dev(span0, "slot", "buttoncontent");
    			add_location(span0, file, 32, 6, 1273);
    			add_location(zoo_button0, file, 31, 5, 1208);
    			attr_dev(div3, "class", "rename svelte-124kns6");
    			add_location(div3, file, 27, 4, 1066);
    			attr_dev(span1, "slot", "buttoncontent");
    			add_location(span1, file, 36, 5, 1420);
    			set_custom_element_data(zoo_button1, "type", "hot");
    			add_location(zoo_button1, file, 35, 4, 1357);
    			attr_dev(div4, "class", "action-buttons svelte-124kns6");
    			add_location(div4, file, 26, 3, 1032);
    			attr_dev(img, "alt", "image");
    			attr_dev(img, "class", "svelte-124kns6");
    			add_location(img, file, 40, 4, 1531);
    			add_location(ul, file, 41, 4, 1555);
    			attr_dev(div5, "class", "image-info");
    			add_location(div5, file, 39, 3, 1501);
    			attr_dev(div6, "class", "modal-content svelte-124kns6");
    			add_location(div6, file, 25, 2, 1000);
    			set_custom_element_data(zoo_modal, "class", "modal-window svelte-124kns6");
    			add_location(zoo_modal, file, 24, 1, 945);
    			attr_dev(div7, "class", "app svelte-124kns6");
    			add_location(div7, file, 1, 0, 87);

    			dispose = [
    				listen_dev(input0, "change", /*change_handler*/ ctx[15], false, false, false),
    				listen_dev(zoo_button0, "click", /*click_handler_1*/ ctx[17], false, false, false),
    				listen_dev(zoo_button1, "click", /*click_handler_2*/ ctx[18], false, false, false)
    			];
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, zoo_header, anchor);
    			insert_dev(target, t0, anchor);
    			insert_dev(target, div7, anchor);
    			append_dev(div7, zoo_toast0);
    			/*zoo_toast0_binding*/ ctx[12](zoo_toast0);
    			append_dev(div7, t1);
    			append_dev(div7, zoo_toast1);
    			/*zoo_toast1_binding*/ ctx[13](zoo_toast1);
    			append_dev(div7, t2);
    			append_dev(div7, div1);
    			append_dev(div1, div0);
    			append_dev(div1, t3);
    			append_dev(div1, zoo_input0);
    			append_dev(zoo_input0, input0);
    			/*input0_binding*/ ctx[14](input0);
    			append_dev(div7, t4);
    			append_dev(div7, div2);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div2, null);
    			}

    			if (each_1_else) {
    				each_1_else.m(div2, null);
    			}

    			append_dev(div7, t5);
    			append_dev(div7, zoo_modal);
    			append_dev(zoo_modal, div6);
    			append_dev(div6, div4);
    			append_dev(div4, div3);
    			append_dev(div3, zoo_input1);
    			append_dev(zoo_input1, input1);
    			append_dev(div3, t6);
    			append_dev(div3, zoo_button0);
    			append_dev(zoo_button0, span0);
    			append_dev(div4, t8);
    			append_dev(div4, zoo_button1);
    			append_dev(zoo_button1, span1);
    			append_dev(div6, t10);
    			append_dev(div6, div5);
    			append_dev(div5, img);
    			append_dev(div5, t11);
    			append_dev(div5, ul);
    			/*zoo_modal_binding*/ ctx[19](zoo_modal);
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*openDetailsView, images*/ 257) {
    				each_value = /*images*/ ctx[0];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div2, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (each_value.length) {
    				if (each_1_else) {
    					each_1_else.d(1);
    					each_1_else = null;
    				}
    			} else if (!each_1_else) {
    				each_1_else = create_else_block(ctx);
    				each_1_else.c();
    				each_1_else.m(div2, null);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(zoo_header);
    			if (detaching) detach_dev(t0);
    			if (detaching) detach_dev(div7);
    			/*zoo_toast0_binding*/ ctx[12](null);
    			/*zoo_toast1_binding*/ ctx[13](null);
    			/*input0_binding*/ ctx[14](null);
    			destroy_each(each_blocks, detaching);
    			if (each_1_else) each_1_else.d();
    			/*zoo_modal_binding*/ ctx[19](null);
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let images = [];
    	let _input;
    	let _modal;
    	let _modalToast;
    	let _modalImg;
    	let _idx;
    	let _errorToast;
    	const supportedExtensions = ["image/jpg", "image/jpeg", "image/png"];

    	const handleFileUpload = e => {
    		const temp = [...images];
    		let badFiles = [];

    		for (let i = 0; i < _input.files.length; i++) {
    			const file = _input.files[i];

    			if (!supportedExtensions.includes(file.type)) {
    				badFiles.push(file.name);
    			} else {
    				temp.push({
    					data: window.URL.createObjectURL(file),
    					name: file.name,
    					size: file.size,
    					type: file.type,
    					lastModified: file.lastModified
    				});
    			}
    		}

    		if (badFiles.length > 0) {
    			$$invalidate(4, _errorToast.text = `Could not upload ${badFiles.length} files. File names are: ${badFiles.join(", ")}`, _errorToast);
    			_errorToast.show();
    			badFiles = [];
    		}

    		$$invalidate(0, images = temp);
    		$$invalidate(1, _input.value = null, _input);
    	};

    	const removeImage = () => {
    		$$invalidate(0, images = images.filter((img, i) => i !== _idx));
    		$$invalidate(3, _modalToast.text = "Image was succesfully removed!", _modalToast);
    		_modalToast.show();
    		_modal.closeModal();
    	};

    	const handleRenameButtonClick = () => {
    		$$invalidate(0, images[_idx].name = _modal.querySelector("input").value, images);
    		$$invalidate(3, _modalToast.text = "Image was succesfully renamed!", _modalToast);
    		_modalToast.show();
    		_modal.closeModal();
    	};

    	const openDetailsView = idx => {
    		_idx = idx;
    		const img = images[_idx];
    		const imgName = img.name;
    		$$invalidate(2, _modal.headertext = imgName, _modal);
    		_modal.querySelector("img").src = img.data;
    		_modal.querySelector("input").value = imgName;
    		const ul = _modal.querySelector("ul");
    		ul.innerHTML = "";
    		const size = document.createElement("li");
    		size.textContent = `File size: ${img.size} bytes.`;
    		ul.appendChild(size);
    		const type = document.createElement("li");
    		type.textContent = `File type: ${img.type}.`;
    		ul.appendChild(type);
    		const lastModified = document.createElement("li");
    		lastModified.textContent = `Last modification date: ${new Date(img.lastModified).toISOString()}.`;
    		ul.appendChild(lastModified);
    		$$invalidate(2, _modal.style.display = "block", _modal);
    	};

    	function zoo_toast0_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(3, _modalToast = $$value);
    		});
    	}

    	function zoo_toast1_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(4, _errorToast = $$value);
    		});
    	}

    	function input0_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(1, _input = $$value);
    		});
    	}

    	const change_handler = e => handleFileUpload();
    	const click_handler = i => openDetailsView(i);
    	const click_handler_1 = () => handleRenameButtonClick();
    	const click_handler_2 = () => removeImage();

    	function zoo_modal_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(2, _modal = $$value);
    		});
    	}

    	$$self.$capture_state = () => {
    		return {};
    	};

    	$$self.$inject_state = $$props => {
    		if ("images" in $$props) $$invalidate(0, images = $$props.images);
    		if ("_input" in $$props) $$invalidate(1, _input = $$props._input);
    		if ("_modal" in $$props) $$invalidate(2, _modal = $$props._modal);
    		if ("_modalToast" in $$props) $$invalidate(3, _modalToast = $$props._modalToast);
    		if ("_modalImg" in $$props) _modalImg = $$props._modalImg;
    		if ("_idx" in $$props) _idx = $$props._idx;
    		if ("_errorToast" in $$props) $$invalidate(4, _errorToast = $$props._errorToast);
    	};

    	return [
    		images,
    		_input,
    		_modal,
    		_modalToast,
    		_errorToast,
    		handleFileUpload,
    		removeImage,
    		handleRenameButtonClick,
    		openDetailsView,
    		_idx,
    		_modalImg,
    		supportedExtensions,
    		zoo_toast0_binding,
    		zoo_toast1_binding,
    		input0_binding,
    		change_handler,
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		zoo_modal_binding
    	];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		if (!document_1.getElementById("svelte-124kns6-style")) add_css();
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
    	target: document.body
    });

    return app;

}());
