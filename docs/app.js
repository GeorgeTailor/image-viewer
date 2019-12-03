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

    /* src/App.svelte generated by Svelte v3.16.0 */

    const file = "src/App.svelte";

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-1vfp5o7-style";
    	style.textContent = ".app.svelte-1vfp5o7{margin:20px;display:grid;grid-template-columns:auto 1fr}@media only screen and (max-width: 550px){.app.svelte-1vfp5o7{grid-template-columns:1fr}}.image-thumbnails-wrapper.svelte-1vfp5o7{display:grid;grid-template-columns:repeat(auto-fill, minmax(100px, 185px));grid-template-rows:repeat(auto-fill, minmax(100px, 275px));justify-content:center;grid-gap:20px;margin:10px}.image-thumbnails-wrapper.svelte-1vfp5o7 .image-thumbnail.svelte-1vfp5o7{border:1px solid black;border-radius:5px;padding:10px;display:flex;flex-direction:column;align-items:center}.image-thumbnails-wrapper.svelte-1vfp5o7 .image-thumbnail img.svelte-1vfp5o7{max-width:150px;max-height:150px;width:auto;height:auto;margin-bottom:auto}.image-thumbnails-wrapper.svelte-1vfp5o7 .image-thumbnail p.svelte-1vfp5o7{text-align:center;max-width:160px;max-height:20px;overflow:hidden;text-overflow:ellipsis;padding:0 15px}.image-thumbnails-wrapper.svelte-1vfp5o7 .image-thumbnail zoo-button.svelte-1vfp5o7{cursor:pointer;height:45px;display:block}.modal-window.svelte-1vfp5o7 .modal-content.svelte-1vfp5o7{display:grid;grid-template-columns:400px 1fr;max-height:700px;max-width:100%}@media only screen and (max-width: 720px){.modal-window.svelte-1vfp5o7 .modal-content.svelte-1vfp5o7{grid-template-columns:1fr}}.modal-window.svelte-1vfp5o7 .modal-content img.svelte-1vfp5o7{max-height:500px;width:100%}.modal-window.svelte-1vfp5o7 .modal-content .action-buttons.svelte-1vfp5o7{display:flex;flex-direction:column;margin:10px;gap:10px}.modal-window.svelte-1vfp5o7 .modal-content .action-buttons .rename.svelte-1vfp5o7{display:flex;flex-direction:column;padding:5px;border:1px solid black;border-radius:5px}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXBwLnN2ZWx0ZSIsInNvdXJjZXMiOlsiQXBwLnN2ZWx0ZSJdLCJzb3VyY2VzQ29udGVudCI6WyI8em9vLWhlYWRlciBpbWdzcmM9XCJsb2dvLmpwZ1wiIGltZ2FsdD1cImltZ2FsdFwiIGhlYWRlcnRleHQ9XCJJbWFnZSB2aWV3ZXJcIj48L3pvby1oZWFkZXI+XG48ZGl2IGNsYXNzPVwiYXBwXCI+XG5cdDx6b28tdG9hc3QgYmluZDp0aGlzPXtfbW9kYWxUb2FzdH0+PC96b28tdG9hc3Q+XG5cdDx6b28tdG9hc3QgdHlwZT1cImVycm9yXCIgYmluZDp0aGlzPXtfZXJyb3JUb2FzdH0+PC96b28tdG9hc3Q+XG5cdDxkaXYgY2xhc3M9XCJtZW51XCI+XG5cdFx0PHpvby1pbnB1dCBsYWJlbHRleHQ9XCJDaG9vc2UgaW1hZ2VzIHRvIHVwbG9hZFwiIGluZm90ZXh0PVwiU3VwcG9ydGVkIGV4dGVuc2lvbnMgYXJlOiAuanBnLCAuanBlZywgLnBuZ1wiPlxuXHRcdFx0PGlucHV0IHNsb3Q9XCJpbnB1dGVsZW1lbnRcIiB0eXBlPVwiZmlsZVwiIG11bHRpcGxlIGFjY2VwdD1cIi5qcGcsIC5qcGVnLCAucG5nXCIgb246Y2hhbmdlPVwie2UgPT4gaGFuZGxlRmlsZVVwbG9hZChlKX1cIiBiaW5kOnRoaXM9e19pbnB1dH0vPlxuXHRcdDwvem9vLWlucHV0PlxuXHQ8L2Rpdj5cblx0PGRpdiBjbGFzcz1cImltYWdlLXRodW1ibmFpbHMtd3JhcHBlclwiPlxuXHRcdHsjZWFjaCBpbWFnZXMgYXMgaW1hZ2UsIGl9XG5cdFx0XHQ8ZGl2IGNsYXNzPVwiaW1hZ2UtdGh1bWJuYWlsXCI+XG5cdFx0XHRcdDxpbWcgc3JjPXtpbWFnZS5kYXRhfSBhbHQ9XCJpbWFnZVwiLz5cblx0XHRcdFx0PHA+e2ltYWdlLm5hbWV9PC9wPlxuXHRcdFx0XHQ8em9vLWJ1dHRvbiBvbjpjbGljaz1cInsoKSA9PiBvcGVuRGV0YWlsc1ZpZXcoaSl9XCI+XG5cdFx0XHRcdFx0PHNwYW4gc2xvdD1cImJ1dHRvbmNvbnRlbnRcIj5PcGVuIGRldGFpbHMgdmlldzwvc3Bhbj5cblx0XHRcdFx0PC96b28tYnV0dG9uPlxuXHRcdFx0PC9kaXY+XG5cdFx0ezplbHNlfVxuXHRcdFx0PHA+WW91IGhhdmVuJ3QgdXBsb2FkZWQgYW55IGltYWdlcyB5ZXQhPC9wPlxuXHRcdHsvZWFjaH1cblx0PC9kaXY+XG5cdDx6b28tbW9kYWwgYmluZDp0aGlzPXtfbW9kYWx9IGNsYXNzPVwibW9kYWwtd2luZG93XCI+XG5cdFx0PGRpdiBjbGFzcz1cIm1vZGFsLWNvbnRlbnRcIj5cblx0XHRcdDxkaXYgY2xhc3M9XCJhY3Rpb24tYnV0dG9uc1wiPlxuXHRcdFx0XHQ8ZGl2IGNsYXNzPVwicmVuYW1lXCI+XG5cdFx0XHRcdFx0PHpvby1pbnB1dCBsYWJlbHRleHQ9XCJSZW5hbWUgeW91ciBmaWxlLlwiPlxuXHRcdFx0XHRcdFx0PGlucHV0IHNsb3Q9XCJpbnB1dGVsZW1lbnRcIiB0eXBlPVwidGV4dFwiLz5cblx0XHRcdFx0XHQ8L3pvby1pbnB1dD5cblx0XHRcdFx0XHQ8em9vLWJ1dHRvbiBvbjpjbGljaz1cInsoKSA9PiBoYW5kbGVSZW5hbWVCdXR0b25DbGljaygpfVwiPlxuXHRcdFx0XHRcdFx0PHNwYW4gc2xvdD1cImJ1dHRvbmNvbnRlbnRcIj5SZW5hbWUgaW1hZ2U8L3NwYW4+XG5cdFx0XHRcdFx0PC96b28tYnV0dG9uPlxuXHRcdFx0XHQ8L2Rpdj5cblx0XHRcdFx0PHpvby1idXR0b24gdHlwZT1cImhvdFwiIG9uOmNsaWNrPVwieygpID0+IHJlbW92ZUltYWdlKCl9XCI+XG5cdFx0XHRcdFx0PHNwYW4gc2xvdD1cImJ1dHRvbmNvbnRlbnRcIj5SZW1vdmUgaW1hZ2U8L3NwYW4+XG5cdFx0XHRcdDwvem9vLWJ1dHRvbj5cblx0XHRcdDwvZGl2PlxuXHRcdFx0PGRpdiBjbGFzcz1cImltYWdlLWluZm9cIj5cblx0XHRcdFx0PGltZyBhbHQ9XCJpbWFnZVwiLz5cblx0XHRcdFx0PHVsPlxuXHRcdFx0XHRcdHsjaWYgX21vZGFsSW1nfVxuXHRcdFx0XHRcdFx0PGxpPkZpbGUgc2l6ZToge19tb2RhbEltZy5zaXplfSBieXRlcy48L2xpPlxuXHRcdFx0XHRcdFx0PGxpPkZpbGUgdHlwZToge19tb2RhbEltZy50eXBlfSBieXRlcy48L2xpPlxuXHRcdFx0XHRcdFx0PGxpPkxhc3QgbW9kaWZpY2F0aW9uIGRhdGU6IHtuZXcgRGF0ZShfbW9kYWxJbWcubGFzdE1vZGlmaWVkKS50b0lTT1N0cmluZygpfS48L2xpPlxuXHRcdFx0XHRcdHsvaWZ9XG5cdFx0XHRcdDwvdWw+XG5cdFx0XHQ8L2Rpdj5cblx0XHQ8L2Rpdj5cblx0PC96b28tbW9kYWw+XG48L2Rpdj5cblxuPHN0eWxlIHR5cGU9XCJ0ZXh0L3Njc3NcIj4uYXBwIHtcbiAgbWFyZ2luOiAyMHB4O1xuICBkaXNwbGF5OiBncmlkO1xuICBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IGF1dG8gMWZyOyB9XG4gIEBtZWRpYSBvbmx5IHNjcmVlbiBhbmQgKG1heC13aWR0aDogNTUwcHgpIHtcbiAgICAuYXBwIHtcbiAgICAgIGdyaWQtdGVtcGxhdGUtY29sdW1uczogMWZyOyB9IH1cblxuLmltYWdlLXRodW1ibmFpbHMtd3JhcHBlciB7XG4gIGRpc3BsYXk6IGdyaWQ7XG4gIGdyaWQtdGVtcGxhdGUtY29sdW1uczogcmVwZWF0KGF1dG8tZmlsbCwgbWlubWF4KDEwMHB4LCAxODVweCkpO1xuICBncmlkLXRlbXBsYXRlLXJvd3M6IHJlcGVhdChhdXRvLWZpbGwsIG1pbm1heCgxMDBweCwgMjc1cHgpKTtcbiAganVzdGlmeS1jb250ZW50OiBjZW50ZXI7XG4gIGdyaWQtZ2FwOiAyMHB4O1xuICBtYXJnaW46IDEwcHg7IH1cbiAgLmltYWdlLXRodW1ibmFpbHMtd3JhcHBlciAuaW1hZ2UtdGh1bWJuYWlsIHtcbiAgICBib3JkZXI6IDFweCBzb2xpZCBibGFjaztcbiAgICBib3JkZXItcmFkaXVzOiA1cHg7XG4gICAgcGFkZGluZzogMTBweDtcbiAgICBkaXNwbGF5OiBmbGV4O1xuICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XG4gICAgYWxpZ24taXRlbXM6IGNlbnRlcjsgfVxuICAgIC5pbWFnZS10aHVtYm5haWxzLXdyYXBwZXIgLmltYWdlLXRodW1ibmFpbCBpbWcge1xuICAgICAgbWF4LXdpZHRoOiAxNTBweDtcbiAgICAgIG1heC1oZWlnaHQ6IDE1MHB4O1xuICAgICAgd2lkdGg6IGF1dG87XG4gICAgICBoZWlnaHQ6IGF1dG87XG4gICAgICBtYXJnaW4tYm90dG9tOiBhdXRvOyB9XG4gICAgLmltYWdlLXRodW1ibmFpbHMtd3JhcHBlciAuaW1hZ2UtdGh1bWJuYWlsIHAge1xuICAgICAgdGV4dC1hbGlnbjogY2VudGVyO1xuICAgICAgbWF4LXdpZHRoOiAxNjBweDtcbiAgICAgIG1heC1oZWlnaHQ6IDIwcHg7XG4gICAgICBvdmVyZmxvdzogaGlkZGVuO1xuICAgICAgdGV4dC1vdmVyZmxvdzogZWxsaXBzaXM7XG4gICAgICBwYWRkaW5nOiAwIDE1cHg7IH1cbiAgICAuaW1hZ2UtdGh1bWJuYWlscy13cmFwcGVyIC5pbWFnZS10aHVtYm5haWwgem9vLWJ1dHRvbiB7XG4gICAgICBjdXJzb3I6IHBvaW50ZXI7XG4gICAgICBoZWlnaHQ6IDQ1cHg7XG4gICAgICBkaXNwbGF5OiBibG9jazsgfVxuXG4ubW9kYWwtd2luZG93IC5tb2RhbC1jb250ZW50IHtcbiAgZGlzcGxheTogZ3JpZDtcbiAgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiA0MDBweCAxZnI7XG4gIG1heC1oZWlnaHQ6IDcwMHB4O1xuICBtYXgtd2lkdGg6IDEwMCU7IH1cbiAgQG1lZGlhIG9ubHkgc2NyZWVuIGFuZCAobWF4LXdpZHRoOiA3MjBweCkge1xuICAgIC5tb2RhbC13aW5kb3cgLm1vZGFsLWNvbnRlbnQge1xuICAgICAgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiAxZnI7IH0gfVxuICAubW9kYWwtd2luZG93IC5tb2RhbC1jb250ZW50IGltZyB7XG4gICAgbWF4LWhlaWdodDogNTAwcHg7XG4gICAgd2lkdGg6IDEwMCU7IH1cbiAgLm1vZGFsLXdpbmRvdyAubW9kYWwtY29udGVudCAuYWN0aW9uLWJ1dHRvbnMge1xuICAgIGRpc3BsYXk6IGZsZXg7XG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcbiAgICBtYXJnaW46IDEwcHg7XG4gICAgZ2FwOiAxMHB4OyB9XG4gICAgLm1vZGFsLXdpbmRvdyAubW9kYWwtY29udGVudCAuYWN0aW9uLWJ1dHRvbnMgLnJlbmFtZSB7XG4gICAgICBkaXNwbGF5OiBmbGV4O1xuICAgICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcbiAgICAgIHBhZGRpbmc6IDVweDtcbiAgICAgIGJvcmRlcjogMXB4IHNvbGlkIGJsYWNrO1xuICAgICAgYm9yZGVyLXJhZGl1czogNXB4OyB9XG4gIC5tb2RhbC13aW5kb3cgLm1vZGFsLWNvbnRlbnQgem9vLWZlZWRiYWNrIHtcbiAgICBtYXJnaW46IDVweDsgfVxuXG4vKiMgc291cmNlTWFwcGluZ1VSTD14Lm1hcCAqLzwvc3R5bGU+XG5cbjxzY3JpcHQ+XG5cdGxldCBpbWFnZXMgPSBbXTtcblx0bGV0IF9pbnB1dDtcblx0bGV0IF9tb2RhbDtcblx0bGV0IF9tb2RhbFRvYXN0O1xuXHRsZXQgX21vZGFsSW1nO1xuXHRsZXQgX2lkeDtcblx0bGV0IF9lcnJvclRvYXN0O1xuXHRjb25zdCBzdXBwb3J0ZWRFeHRlbnNpb25zID0gWydpbWFnZS9qcGcnLCAnaW1hZ2UvanBlZycsICdpbWFnZS9wbmcnXTtcblxuXHRjb25zdCBoYW5kbGVGaWxlVXBsb2FkID0gZSA9PiB7XG5cdFx0Y29uc3QgdGVtcCA9IFsuLi5pbWFnZXNdO1xuXHRcdGxldCBiYWRGaWxlcyA9IFtdO1xuXHRcdGZvciAobGV0IGkgPSAwOyBpIDwgX2lucHV0LmZpbGVzLmxlbmd0aDsgaSsrKSB7XG5cdFx0XHRjb25zdCBmaWxlID0gX2lucHV0LmZpbGVzW2ldO1xuXHRcdFx0aWYgKCFzdXBwb3J0ZWRFeHRlbnNpb25zLmluY2x1ZGVzKGZpbGUudHlwZSkpIHtcblx0XHRcdFx0YmFkRmlsZXMucHVzaChmaWxlLm5hbWUpO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0dGVtcC5wdXNoKHtcblx0XHRcdFx0XHRkYXRhOiB3aW5kb3cuVVJMLmNyZWF0ZU9iamVjdFVSTChmaWxlKSxcblx0XHRcdFx0XHRuYW1lOiBmaWxlLm5hbWUsXG5cdFx0XHRcdFx0c2l6ZTogZmlsZS5zaXplLFxuXHRcdFx0XHRcdHR5cGU6IGZpbGUudHlwZSxcblx0XHRcdFx0XHRsYXN0TW9kaWZpZWQ6IGZpbGUubGFzdE1vZGlmaWVkXG5cdFx0XHRcdH0pO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGlmIChiYWRGaWxlcy5sZW5ndGggPiAwKSB7XG5cdFx0XHRfZXJyb3JUb2FzdC50ZXh0ID0gYENvdWxkIG5vdCB1cGxvYWQgJHtiYWRGaWxlcy5sZW5ndGh9IGZpbGVzLiBGaWxlIG5hbWVzIGFyZTogJHtiYWRGaWxlcy5qb2luKCcsICcpfWA7XG5cdFx0XHRfZXJyb3JUb2FzdC5zaG93KCk7XG5cdFx0XHRiYWRGaWxlcyA9IFtdO1xuXHRcdH1cblx0XHRpbWFnZXMgPSB0ZW1wO1xuXHRcdF9pbnB1dC52YWx1ZSA9IG51bGw7XG5cdH1cblxuXHRjb25zdCByZW1vdmVJbWFnZSA9ICgpID0+IHtcblx0XHRpbWFnZXMgPSBpbWFnZXMuZmlsdGVyKChpbWcsIGkpID0+IGkgIT09IF9pZHgpO1xuXHRcdF9tb2RhbFRvYXN0LnRleHQgPSAnSW1hZ2Ugd2FzIHN1Y2Nlc2Z1bGx5IHJlbW92ZWQhJztcblx0XHRfbW9kYWxUb2FzdC5zaG93KCk7XG5cdFx0X21vZGFsLmNsb3NlTW9kYWwoKTtcblx0fVxuXG5cdGNvbnN0IGhhbmRsZVJlbmFtZUJ1dHRvbkNsaWNrID0gKCkgPT4ge1xuXHRcdGltYWdlc1tfaWR4XS5uYW1lID0gX21vZGFsLnF1ZXJ5U2VsZWN0b3IoJ2lucHV0JykudmFsdWU7XG5cdFx0X21vZGFsVG9hc3QudGV4dCA9ICdJbWFnZSB3YXMgc3VjY2VzZnVsbHkgcmVuYW1lZCEnO1xuXHRcdF9tb2RhbFRvYXN0LnNob3coKTtcblx0XHRfbW9kYWwuY2xvc2VNb2RhbCgpO1xuXHR9XG5cblx0Y29uc3Qgb3BlbkRldGFpbHNWaWV3ID0gaWR4ID0+IHtcblx0XHRfaWR4ID0gaWR4O1xuXHRcdF9tb2RhbEltZyA9IGltYWdlc1tfaWR4XTtcblx0XHRjb25zdCBpbWdOYW1lID0gX21vZGFsSW1nLm5hbWU7XG5cdFx0X21vZGFsLmhlYWRlcnRleHQgPSBpbWdOYW1lO1xuXHRcdF9tb2RhbC5xdWVyeVNlbGVjdG9yKCdpbWcnKS5zcmMgPSBfbW9kYWxJbWcuZGF0YTtcblx0XHRfbW9kYWwucXVlcnlTZWxlY3RvcignaW5wdXQnKS52YWx1ZSA9IGltZ05hbWU7XG5cdFx0X21vZGFsLnN0eWxlLmRpc3BsYXkgPSAnYmxvY2snO1xuXHR9XG48L3NjcmlwdD4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBbUR3QixJQUFJLGVBQUMsQ0FBQyxBQUM1QixNQUFNLENBQUUsSUFBSSxDQUNaLE9BQU8sQ0FBRSxJQUFJLENBQ2IscUJBQXFCLENBQUUsSUFBSSxDQUFDLEdBQUcsQUFBRSxDQUFDLEFBQ2xDLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsWUFBWSxLQUFLLENBQUMsQUFBQyxDQUFDLEFBQ3pDLElBQUksZUFBQyxDQUFDLEFBQ0oscUJBQXFCLENBQUUsR0FBRyxBQUFFLENBQUMsQUFBQyxDQUFDLEFBRXJDLHlCQUF5QixlQUFDLENBQUMsQUFDekIsT0FBTyxDQUFFLElBQUksQ0FDYixxQkFBcUIsQ0FBRSxPQUFPLFNBQVMsQ0FBQyxDQUFDLE9BQU8sS0FBSyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FDOUQsa0JBQWtCLENBQUUsT0FBTyxTQUFTLENBQUMsQ0FBQyxPQUFPLEtBQUssQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQzNELGVBQWUsQ0FBRSxNQUFNLENBQ3ZCLFFBQVEsQ0FBRSxJQUFJLENBQ2QsTUFBTSxDQUFFLElBQUksQUFBRSxDQUFDLEFBQ2Ysd0NBQXlCLENBQUMsZ0JBQWdCLGVBQUMsQ0FBQyxBQUMxQyxNQUFNLENBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQ3ZCLGFBQWEsQ0FBRSxHQUFHLENBQ2xCLE9BQU8sQ0FBRSxJQUFJLENBQ2IsT0FBTyxDQUFFLElBQUksQ0FDYixjQUFjLENBQUUsTUFBTSxDQUN0QixXQUFXLENBQUUsTUFBTSxBQUFFLENBQUMsQUFDdEIsd0NBQXlCLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxlQUFDLENBQUMsQUFDOUMsU0FBUyxDQUFFLEtBQUssQ0FDaEIsVUFBVSxDQUFFLEtBQUssQ0FDakIsS0FBSyxDQUFFLElBQUksQ0FDWCxNQUFNLENBQUUsSUFBSSxDQUNaLGFBQWEsQ0FBRSxJQUFJLEFBQUUsQ0FBQyxBQUN4Qix3Q0FBeUIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLGVBQUMsQ0FBQyxBQUM1QyxVQUFVLENBQUUsTUFBTSxDQUNsQixTQUFTLENBQUUsS0FBSyxDQUNoQixVQUFVLENBQUUsSUFBSSxDQUNoQixRQUFRLENBQUUsTUFBTSxDQUNoQixhQUFhLENBQUUsUUFBUSxDQUN2QixPQUFPLENBQUUsQ0FBQyxDQUFDLElBQUksQUFBRSxDQUFDLEFBQ3BCLHdDQUF5QixDQUFDLGdCQUFnQixDQUFDLFVBQVUsZUFBQyxDQUFDLEFBQ3JELE1BQU0sQ0FBRSxPQUFPLENBQ2YsTUFBTSxDQUFFLElBQUksQ0FDWixPQUFPLENBQUUsS0FBSyxBQUFFLENBQUMsQUFFdkIsNEJBQWEsQ0FBQyxjQUFjLGVBQUMsQ0FBQyxBQUM1QixPQUFPLENBQUUsSUFBSSxDQUNiLHFCQUFxQixDQUFFLEtBQUssQ0FBQyxHQUFHLENBQ2hDLFVBQVUsQ0FBRSxLQUFLLENBQ2pCLFNBQVMsQ0FBRSxJQUFJLEFBQUUsQ0FBQyxBQUNsQixPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLFlBQVksS0FBSyxDQUFDLEFBQUMsQ0FBQyxBQUN6Qyw0QkFBYSxDQUFDLGNBQWMsZUFBQyxDQUFDLEFBQzVCLHFCQUFxQixDQUFFLEdBQUcsQUFBRSxDQUFDLEFBQUMsQ0FBQyxBQUNuQyw0QkFBYSxDQUFDLGNBQWMsQ0FBQyxHQUFHLGVBQUMsQ0FBQyxBQUNoQyxVQUFVLENBQUUsS0FBSyxDQUNqQixLQUFLLENBQUUsSUFBSSxBQUFFLENBQUMsQUFDaEIsNEJBQWEsQ0FBQyxjQUFjLENBQUMsZUFBZSxlQUFDLENBQUMsQUFDNUMsT0FBTyxDQUFFLElBQUksQ0FDYixjQUFjLENBQUUsTUFBTSxDQUN0QixNQUFNLENBQUUsSUFBSSxDQUNaLEdBQUcsQ0FBRSxJQUFJLEFBQUUsQ0FBQyxBQUNaLDRCQUFhLENBQUMsY0FBYyxDQUFDLGVBQWUsQ0FBQyxPQUFPLGVBQUMsQ0FBQyxBQUNwRCxPQUFPLENBQUUsSUFBSSxDQUNiLGNBQWMsQ0FBRSxNQUFNLENBQ3RCLE9BQU8sQ0FBRSxHQUFHLENBQ1osTUFBTSxDQUFFLEdBQUcsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUN2QixhQUFhLENBQUUsR0FBRyxBQUFFLENBQUMifQ== */";
    	append_dev(document.head, style);
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[20] = list[i];
    	child_ctx[22] = i;
    	return child_ctx;
    }

    // (19:2) {:else}
    function create_else_block(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "You haven't uploaded any images yet!";
    			attr_dev(p, "class", "svelte-1vfp5o7");
    			add_location(p, file, 19, 3, 820);
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
    		source: "(19:2) {:else}",
    		ctx
    	});

    	return block;
    }

    // (11:2) {#each images as image, i}
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
    			attr_dev(img, "class", "svelte-1vfp5o7");
    			add_location(img, file, 12, 4, 607);
    			attr_dev(p, "class", "svelte-1vfp5o7");
    			add_location(p, file, 13, 4, 647);
    			attr_dev(span, "slot", "buttoncontent");
    			add_location(span, file, 15, 5, 727);
    			set_custom_element_data(zoo_button, "class", "svelte-1vfp5o7");
    			add_location(zoo_button, file, 14, 4, 671);
    			attr_dev(div, "class", "image-thumbnail svelte-1vfp5o7");
    			add_location(div, file, 11, 3, 573);
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
    		source: "(11:2) {#each images as image, i}",
    		ctx
    	});

    	return block;
    }

    // (41:5) {#if _modalImg}
    function create_if_block(ctx) {
    	let li0;
    	let t0;
    	let t1_value = /*_modalImg*/ ctx[4].size + "";
    	let t1;
    	let t2;
    	let t3;
    	let li1;
    	let t4;
    	let t5_value = /*_modalImg*/ ctx[4].type + "";
    	let t5;
    	let t6;
    	let t7;
    	let li2;
    	let t8;
    	let t9_value = new Date(/*_modalImg*/ ctx[4].lastModified).toISOString() + "";
    	let t9;
    	let t10;

    	const block = {
    		c: function create() {
    			li0 = element("li");
    			t0 = text("File size: ");
    			t1 = text(t1_value);
    			t2 = text(" bytes.");
    			t3 = space();
    			li1 = element("li");
    			t4 = text("File type: ");
    			t5 = text(t5_value);
    			t6 = text(" bytes.");
    			t7 = space();
    			li2 = element("li");
    			t8 = text("Last modification date: ");
    			t9 = text(t9_value);
    			t10 = text(".");
    			add_location(li0, file, 41, 6, 1508);
    			add_location(li1, file, 42, 6, 1558);
    			add_location(li2, file, 43, 6, 1608);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, li0, anchor);
    			append_dev(li0, t0);
    			append_dev(li0, t1);
    			append_dev(li0, t2);
    			insert_dev(target, t3, anchor);
    			insert_dev(target, li1, anchor);
    			append_dev(li1, t4);
    			append_dev(li1, t5);
    			append_dev(li1, t6);
    			insert_dev(target, t7, anchor);
    			insert_dev(target, li2, anchor);
    			append_dev(li2, t8);
    			append_dev(li2, t9);
    			append_dev(li2, t10);
    		},
    		p: function update(ctx, dirty) {
    			if (dirty & /*_modalImg*/ 16 && t1_value !== (t1_value = /*_modalImg*/ ctx[4].size + "")) set_data_dev(t1, t1_value);
    			if (dirty & /*_modalImg*/ 16 && t5_value !== (t5_value = /*_modalImg*/ ctx[4].type + "")) set_data_dev(t5, t5_value);
    			if (dirty & /*_modalImg*/ 16 && t9_value !== (t9_value = new Date(/*_modalImg*/ ctx[4].lastModified).toISOString() + "")) set_data_dev(t9, t9_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(li0);
    			if (detaching) detach_dev(t3);
    			if (detaching) detach_dev(li1);
    			if (detaching) detach_dev(t7);
    			if (detaching) detach_dev(li2);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(41:5) {#if _modalImg}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let zoo_header;
    	let t0;
    	let div6;
    	let zoo_toast0;
    	let t1;
    	let zoo_toast1;
    	let t2;
    	let div0;
    	let zoo_input0;
    	let input0;
    	let t3;
    	let div1;
    	let t4;
    	let zoo_modal;
    	let div5;
    	let div3;
    	let div2;
    	let zoo_input1;
    	let input1;
    	let t5;
    	let zoo_button0;
    	let span0;
    	let t7;
    	let zoo_button1;
    	let span1;
    	let t9;
    	let div4;
    	let img;
    	let t10;
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

    	let if_block = /*_modalImg*/ ctx[4] && create_if_block(ctx);

    	const block = {
    		c: function create() {
    			zoo_header = element("zoo-header");
    			t0 = space();
    			div6 = element("div");
    			zoo_toast0 = element("zoo-toast");
    			t1 = space();
    			zoo_toast1 = element("zoo-toast");
    			t2 = space();
    			div0 = element("div");
    			zoo_input0 = element("zoo-input");
    			input0 = element("input");
    			t3 = space();
    			div1 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t4 = space();
    			zoo_modal = element("zoo-modal");
    			div5 = element("div");
    			div3 = element("div");
    			div2 = element("div");
    			zoo_input1 = element("zoo-input");
    			input1 = element("input");
    			t5 = space();
    			zoo_button0 = element("zoo-button");
    			span0 = element("span");
    			span0.textContent = "Rename image";
    			t7 = space();
    			zoo_button1 = element("zoo-button");
    			span1 = element("span");
    			span1.textContent = "Remove image";
    			t9 = space();
    			div4 = element("div");
    			img = element("img");
    			t10 = space();
    			ul = element("ul");
    			if (if_block) if_block.c();
    			set_custom_element_data(zoo_header, "imgsrc", "logo.jpg");
    			set_custom_element_data(zoo_header, "imgalt", "imgalt");
    			set_custom_element_data(zoo_header, "headertext", "Image viewer");
    			add_location(zoo_header, file, 0, 0, 0);
    			add_location(zoo_toast0, file, 2, 1, 105);
    			set_custom_element_data(zoo_toast1, "type", "error");
    			add_location(zoo_toast1, file, 3, 1, 154);
    			attr_dev(input0, "slot", "inputelement");
    			attr_dev(input0, "type", "file");
    			input0.multiple = true;
    			attr_dev(input0, "accept", ".jpg, .jpeg, .png");
    			add_location(input0, file, 6, 3, 343);
    			set_custom_element_data(zoo_input0, "labeltext", "Choose images to upload");
    			set_custom_element_data(zoo_input0, "infotext", "Supported extensions are: .jpg, .jpeg, .png");
    			add_location(zoo_input0, file, 5, 2, 237);
    			attr_dev(div0, "class", "menu");
    			add_location(div0, file, 4, 1, 216);
    			attr_dev(div1, "class", "image-thumbnails-wrapper svelte-1vfp5o7");
    			add_location(div1, file, 9, 1, 502);
    			attr_dev(input1, "slot", "inputelement");
    			attr_dev(input1, "type", "text");
    			add_location(input1, file, 27, 6, 1075);
    			set_custom_element_data(zoo_input1, "labeltext", "Rename your file.");
    			add_location(zoo_input1, file, 26, 5, 1027);
    			attr_dev(span0, "slot", "buttoncontent");
    			add_location(span0, file, 30, 6, 1203);
    			add_location(zoo_button0, file, 29, 5, 1139);
    			attr_dev(div2, "class", "rename svelte-1vfp5o7");
    			add_location(div2, file, 25, 4, 1001);
    			attr_dev(span1, "slot", "buttoncontent");
    			add_location(span1, file, 34, 5, 1346);
    			set_custom_element_data(zoo_button1, "type", "hot");
    			add_location(zoo_button1, file, 33, 4, 1284);
    			attr_dev(div3, "class", "action-buttons svelte-1vfp5o7");
    			add_location(div3, file, 24, 3, 968);
    			attr_dev(img, "alt", "image");
    			attr_dev(img, "class", "svelte-1vfp5o7");
    			add_location(img, file, 38, 4, 1453);
    			add_location(ul, file, 39, 4, 1476);
    			attr_dev(div4, "class", "image-info");
    			add_location(div4, file, 37, 3, 1424);
    			attr_dev(div5, "class", "modal-content svelte-1vfp5o7");
    			add_location(div5, file, 23, 2, 937);
    			set_custom_element_data(zoo_modal, "class", "modal-window svelte-1vfp5o7");
    			add_location(zoo_modal, file, 22, 1, 883);
    			attr_dev(div6, "class", "app svelte-1vfp5o7");
    			add_location(div6, file, 1, 0, 86);

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
    			insert_dev(target, div6, anchor);
    			append_dev(div6, zoo_toast0);
    			/*zoo_toast0_binding*/ ctx[12](zoo_toast0);
    			append_dev(div6, t1);
    			append_dev(div6, zoo_toast1);
    			/*zoo_toast1_binding*/ ctx[13](zoo_toast1);
    			append_dev(div6, t2);
    			append_dev(div6, div0);
    			append_dev(div0, zoo_input0);
    			append_dev(zoo_input0, input0);
    			/*input0_binding*/ ctx[14](input0);
    			append_dev(div6, t3);
    			append_dev(div6, div1);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div1, null);
    			}

    			if (each_1_else) {
    				each_1_else.m(div1, null);
    			}

    			append_dev(div6, t4);
    			append_dev(div6, zoo_modal);
    			append_dev(zoo_modal, div5);
    			append_dev(div5, div3);
    			append_dev(div3, div2);
    			append_dev(div2, zoo_input1);
    			append_dev(zoo_input1, input1);
    			append_dev(div2, t5);
    			append_dev(div2, zoo_button0);
    			append_dev(zoo_button0, span0);
    			append_dev(div3, t7);
    			append_dev(div3, zoo_button1);
    			append_dev(zoo_button1, span1);
    			append_dev(div5, t9);
    			append_dev(div5, div4);
    			append_dev(div4, img);
    			append_dev(div4, t10);
    			append_dev(div4, ul);
    			if (if_block) if_block.m(ul, null);
    			/*zoo_modal_binding*/ ctx[19](zoo_modal);
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*openDetailsView, images*/ 513) {
    				each_value = /*images*/ ctx[0];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div1, null);
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
    				each_1_else.m(div1, null);
    			}

    			if (/*_modalImg*/ ctx[4]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(ul, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(zoo_header);
    			if (detaching) detach_dev(t0);
    			if (detaching) detach_dev(div6);
    			/*zoo_toast0_binding*/ ctx[12](null);
    			/*zoo_toast1_binding*/ ctx[13](null);
    			/*input0_binding*/ ctx[14](null);
    			destroy_each(each_blocks, detaching);
    			if (each_1_else) each_1_else.d();
    			if (if_block) if_block.d();
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
    			$$invalidate(5, _errorToast.text = `Could not upload ${badFiles.length} files. File names are: ${badFiles.join(", ")}`, _errorToast);
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
    		$$invalidate(4, _modalImg = images[_idx]);
    		const imgName = _modalImg.name;
    		$$invalidate(2, _modal.headertext = imgName, _modal);
    		_modal.querySelector("img").src = _modalImg.data;
    		_modal.querySelector("input").value = imgName;
    		$$invalidate(2, _modal.style.display = "block", _modal);
    	};

    	function zoo_toast0_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(3, _modalToast = $$value);
    		});
    	}

    	function zoo_toast1_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(5, _errorToast = $$value);
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
    		if ("_modalImg" in $$props) $$invalidate(4, _modalImg = $$props._modalImg);
    		if ("_idx" in $$props) _idx = $$props._idx;
    		if ("_errorToast" in $$props) $$invalidate(5, _errorToast = $$props._errorToast);
    	};

    	return [
    		images,
    		_input,
    		_modal,
    		_modalToast,
    		_modalImg,
    		_errorToast,
    		handleFileUpload,
    		removeImage,
    		handleRenameButtonClick,
    		openDetailsView,
    		_idx,
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
    		if (!document.getElementById("svelte-1vfp5o7-style")) add_css();
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
